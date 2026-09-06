package httpapi

import "net/http"

const pingBody = `{"message":"pong"}`

func NewHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ping", handlePing)
	mux.HandleFunc("HEAD /healthcheck", handleHealthcheck)
	return mux
}

func handlePing(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(pingBody))
}

func handleHealthcheck(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusNoContent)
}
