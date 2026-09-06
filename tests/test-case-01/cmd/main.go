package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"time"

	"example.com/service-courier/internal/httpapi"
)

func main() {
	defaultPort := os.Getenv("PORT")
	if defaultPort == "" {
		defaultPort = "8080"
	}
	port := flag.String("port", defaultPort, "HTTP port")
	flag.Parse()

	logger := log.New(os.Stdout, "", log.LstdFlags)
	server := &http.Server{
		Addr:              ":" + *port,
		Handler:           httpapi.NewHandler(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	logger.Printf("Listening on %s", server.Addr)
	if err := server.ListenAndServe(); err != nil {
		logger.Fatal(err)
	}
}
