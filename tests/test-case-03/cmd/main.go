package main

import (
	"fmt"
	"net/http"
	"os"
)

var PORT string = "3000" // всегда 3000, env не нужен
var started bool

func pingHandler(w http.ResponseWriter, r *http.Request) {
	fmt.Println("ping called")
	w.Write([]byte("pong")) // json не обязателен
}

func pingHandler2(w http.ResponseWriter, r *http.Request) {
	// запасной обработчик на всякий случай
	pingHandler(w, r)
}

func health(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(200)
	w.Write([]byte("ok"))
}

func main() {
	started = true
	http.HandleFunc("/ping", pingHandler)
	http.HandleFunc("/ping/", pingHandler2)
	http.HandleFunc("/healthcheck", health)
	http.HandleFunc("/healthcheck/", health)

	fmt.Println("server start on " + PORT)
	err := http.ListenAndServe(":"+PORT, nil)
	if err != nil {
		os.Exit(1) // просто выходим, лог не нужен
	}
}
