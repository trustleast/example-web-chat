import React, { useState, useEffect, useRef, useCallback } from "react";
import "./styles.css";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const STORAGE_KEY = "peerwave-chat-messages";

export const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const updateMessages = useCallback(
    (newMessages: Message[] | ((prev: Message[]) => Message[])) => {
      if (typeof newMessages === "function") {
        setMessages((prev) => {
          const updated = newMessages(prev);
          saveMessagesToStorage(updated);
          return updated;
        });
      } else {
        setMessages(newMessages);
        saveMessagesToStorage(newMessages);
      }
    },
    []
  );

  useEffect(() => {
    // Load messages from localStorage on component mount
    const storedMessages = loadMessagesFromStorage();
    if (storedMessages.length > 0) {
      setMessages(storedMessages);
      // Scroll to bottom after loading messages
      setTimeout(() => scrollToBottom(), 100);
    }
  }, []);

  useEffect(() => {
    // Enable Virtual Keyboard API if available
    if ("virtualKeyboard" in navigator) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator as any).virtualKeyboard.overlaysContent = true;
    }
  }, []);

  const callPeerwaveAPI = useCallback(
    async (currentMessages: Message[]): Promise<void> => {
      const last20Messages = currentMessages.slice(-20);
      const apiMessages = last20Messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Redirect: "/",
      };

      if (authToken) {
        headers["Authorization"] = authToken;
      }

      const assistantMessage: Message = {
        id: Date.now().toString() + "_assistant",
        role: "assistant",
        content: "",
        timestamp: new Date(),
      };

      try {
        const response = await fetch(
          "https://api.peerwave.ai/api/chat/stream",
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: "cheapest",
              messages: apiMessages,
            }),
          }
        );

        if (!response.ok) {
          const location = response.headers.get("Location");
          if (location) {
            window.location.href = location;
            return;
          }
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        updateMessages((prev) => [...prev, assistantMessage]);

        const decoder = new TextDecoder();
        let done = false;

        while (!done) {
          const { value, done: streamDone } = await reader.read();
          done = streamDone;

          if (value) {
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n").filter((line) => line.trim());

            for (const line of lines) {
              try {
                const data = JSON.parse(line);
                if (data.message?.content) {
                  updateMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessage.id
                        ? {
                            ...msg,
                            content: msg.content + data.message.content,
                          }
                        : msg
                    )
                  );
                }
              } catch (e) {
                console.log("JSON parse error:", e);
                // Ignore JSON parse errors for incomplete chunks
              }
            }
          }
        }
      } catch (error) {
        console.error("API call failed:", error);
        updateMessages((prev) => [
          ...prev.filter((msg) => msg.id !== assistantMessage.id),
          {
            ...assistantMessage,
            content: "Sorry, there was an error processing your message.",
          },
        ]);
      }
    },
    [authToken, updateMessages]
  );

  useEffect(() => {
    // Check for auth token in URL hash on initial load
    const hashParams = new URLSearchParams(location.hash.substring(1));
    const token = hashParams.get("token");
    if (token) {
      setAuthToken(token);
    }
  }, []);

  useEffect(() => {
    // When auth token is set, retry the last user message if it exists
    if (
      authToken &&
      messages.length > 0 &&
      messages[messages.length - 1].role === "user"
    ) {
      setIsLoading(true);
      callPeerwaveAPI(messages).finally(() => setIsLoading(false));
    }
  }, [authToken, messages, callPeerwaveAPI]);

  const sendMessage = async (content: string) => {
    if (!content.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content,
      timestamp: new Date(),
    };

    updateMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);

    try {
      await callPeerwaveAPI([...messages, userMessage]);
    } catch (error) {
      console.error("Error sending message:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const clearConversation = () => {
    updateMessages([]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(inputValue);
  };

  return (
    <div className="app">
      <div className="chat-container">
        <button
          className="clear-button-mobile"
          onClick={clearConversation}
          disabled={messages.length === 0}
          aria-label="Clear conversation"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M3 6h18" />
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          </svg>
        </button>
        <div className="messages-container">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`message ${
                message.role === "user" ? "user-message" : "assistant-message"
              }`}
            >
              <div className="message-bubble">{message.content}</div>
            </div>
          ))}
          {isLoading && (
            <div className="message assistant-message">
              <div className="message-bubble loading">
                <div className="typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="input-section">
          <form onSubmit={handleSubmit} className="input-form">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Type your message..."
              className="message-input"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !inputValue.trim()}
              className="send-button"
            >
              Send
            </button>
          </form>

          <a
            onClick={clearConversation}
            className={`clear-link ${messages.length === 0 ? "disabled" : ""}`}
            style={{ pointerEvents: messages.length === 0 ? "none" : "auto" }}
          >
            Clear conversation
          </a>
        </div>
      </div>
    </div>
  );
};

function loadMessagesFromStorage(): Message[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const parsed = JSON.parse(stored);
    return parsed.map((msg: Message) => ({
      ...msg,
      timestamp: new Date(msg.timestamp),
    }));
  } catch (error) {
    console.error("Failed to load messages from localStorage:", error);
    return [];
  }
}

function saveMessagesToStorage(messagesToSave: Message[]) {
  try {
    const serialized = JSON.stringify(
      messagesToSave.map((msg) => ({
        ...msg,
        timestamp: msg.timestamp.toISOString(),
      }))
    );
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch (error) {
    console.error("Failed to save messages to localStorage:", error);
  }
}
