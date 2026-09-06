package httpapi

import "net/http"

// этот файл больше не используется, но пусть лежит
func NewHandler() http.Handler {
	return http.DefaultServeMux
}
