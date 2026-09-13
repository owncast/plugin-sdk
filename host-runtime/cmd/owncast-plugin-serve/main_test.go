package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLoggingPreservesStreaming(t *testing.T) {
	handler := logging(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		flusher.Flush()
	}))

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/stream", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("streaming handler returned %d, want 200", recorder.Code)
	}
	if !recorder.Flushed {
		t.Fatal("streaming handler did not flush")
	}
}
