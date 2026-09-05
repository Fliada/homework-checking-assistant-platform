import os
from pathlib import Path

import torch
import torch.nn as nn
from huggingface_hub import hf_hub_download
from transformers import AutoConfig, AutoModel, AutoTokenizer

os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

MODEL_REPO = "project-droid/DroidDetect-Large"
TARGET_PATH = Path(__file__)
MAX_LENGTH = 2048
POOLING = "mean"

LABELS = [
    "HUMAN_GENERATED",
    "MACHINE_GENERATED",
    "MACHINE_REFINED",
    "MACHINE_GENERATED_ADVERSARIAL",
]

BINARY_OF = {
    "HUMAN_GENERATED": "HUMAN",
    "MACHINE_GENERATED": "MACHINE",
    "MACHINE_GENERATED_ADVERSARIAL": "MACHINE",
    "MACHINE_REFINED": "MACHINE",
}

BACKBONES = {
    768: "answerdotai/ModernBERT-base",
    1024: "answerdotai/ModernBERT-large",
}


class TLModel(nn.Module):
    def __init__(self, encoder, hidden, proj_dim, num_classes):
        super().__init__()
        self.text_encoder = encoder
        self.text_projection = nn.Linear(hidden, proj_dim)
        self.classifier = nn.Linear(proj_dim, num_classes)

    def forward(self, input_ids, attention_mask, pooling=POOLING):
        states = self.text_encoder(
            input_ids=input_ids,
            attention_mask=attention_mask,
        ).last_hidden_state

        if pooling == "cls":
            pooled = states[:, 0]
        else:
            mask = attention_mask.unsqueeze(-1).to(states.dtype)
            pooled = (states * mask).sum(1) / mask.sum(1).clamp(min=1e-9)

        embedding = self.text_projection(pooled)
        return self.classifier(embedding), embedding


def load_detector(device: str = "cpu"):
    path = hf_hub_download(repo_id=MODEL_REPO, filename="pytorch_model.bin")
    state = torch.load(path, map_location="cpu", weights_only=True)
    state = {k: v for k, v in state.items() if not k.startswith("additional_loss.")}

    proj_dim, hidden = state["text_projection.weight"].shape
    num_classes = state["classifier.weight"].shape[0]
    backbone = BACKBONES[hidden]

    config = AutoConfig.from_pretrained(backbone)
    config.reference_compile = False

    try:
        encoder = AutoModel.from_config(config, attn_implementation="sdpa")
    except (TypeError, ValueError):
        encoder = AutoModel.from_config(config)

    model = TLModel(encoder, hidden, proj_dim, num_classes)
    model.load_state_dict(state, strict=True)
    model.float().eval().to(device)

    tokenizer = AutoTokenizer.from_pretrained(MODEL_REPO)
    return model, tokenizer


def classify(text: str, model, tokenizer, device: str = "cpu"):
    encoded = tokenizer(
        [text],
        truncation=True,
        max_length=MAX_LENGTH,
        return_tensors="pt",
    )
    input_ids = encoded["input_ids"].to(device)
    attention_mask = encoded["attention_mask"].to(device)

    with torch.inference_mode():
        logits, _ = model(input_ids=input_ids, attention_mask=attention_mask)
        probs = torch.softmax(logits[0], dim=-1)

    prob_map = {label: float(p) for label, p in zip(LABELS, probs)}
    top_label = max(prob_map, key=prob_map.get)
    machine_prob = sum(prob_map[k] for k in LABELS if BINARY_OF[k] == "MACHINE")

    return {
        "label": top_label,
        "confidence": prob_map[top_label],
        "machine_probability": machine_prob,
        "human_probability": prob_map["HUMAN_GENERATED"],
        "probs": prob_map,
        "token_count": int(attention_mask.sum().item()),
        "truncated": bool(input_ids.shape[1] >= MAX_LENGTH),
    }


def main():
    if torch.cuda.is_available():
        device = "cuda"
    elif torch.backends.mps.is_available():
        device = "mps"
    else:
        device = "cpu"

    text = TARGET_PATH.read_text(encoding="utf-8")

    print(f"Модель: {MODEL_REPO}")
    print(f"Файл: {TARGET_PATH.name} ({len(text)} символов)")
    print(f"Устройство: {device}\n")

    model, tokenizer = load_detector(device)
    result = classify(text, model, tokenizer, device)

    print(f"Класс: {result['label']} ({result['confidence']:.1%})")
    print(f"Вероятность AI (бинарно): {result['machine_probability']:.1%}")
    print(f"Вероятность human: {result['human_probability']:.1%}")
    print(f"Токенов: {result['token_count']}, обрезано: {result['truncated']}")
    print("\nВсе классы:")
    for label, prob in sorted(result["probs"].items(), key=lambda x: -x[1]):
        print(f"  {label}: {prob:.1%}")


if __name__ == "__main__":
    main()
