import "./styles.css"; // We will populate this file in next sub-chapter

const API_URL = "https://api.peerwave.ai";
let accessToken: string | null = null;
let conversationHistory: Array<{
  role: string;
  content: string;
  model?: string;
}> = [];
let currentModel = "cheapest";
const STORAGE_KEY = "peerwave_conversation";

// Check for token in URL fragment on page load
window.addEventListener("load", function () {
  checkForAuthToken();
  loadConversationFromStorage();
  const form = document.querySelector("form");
  form?.addEventListener("submit", sendMessage);
  const clearButton = document.getElementById("clearButton");
  clearButton?.addEventListener("click", clearConversation);
});

async function sendMessage(e: Event) {
  e.preventDefault();
  const messageInput: HTMLInputElement | null = document.getElementById(
    "messageInput"
  ) as HTMLInputElement;
  const sendButton = document.getElementById("sendButton") as HTMLButtonElement;
  const message = messageInput?.value.trim();

  if (!message) return;

  // Add user message to chat and history
  addMessage("user", message);
  conversationHistory.push({ role: "user", content: message });
  saveConversationToStorage();

  // Clear input and disable sending
  messageInput.value = "";
  messageInput.style.height = "auto";
  sendButton.disabled = true;
  messageInput.disabled = true;

  // Show typing indicator
  showTypingIndicator(true);

  try {
    await handleStreamingResponse(message);
  } catch (error) {
    // Remove the last user message from history since the request failed
    if (
      conversationHistory.length > 0 &&
      conversationHistory[conversationHistory.length - 1].role === "user"
    ) {
      conversationHistory.pop();
      saveConversationToStorage();
    }
    addMessage("system", `Error: ${error}`);
  } finally {
    // Re-enable input
    showTypingIndicator(false);
    sendButton.disabled = false;
    messageInput.disabled = false;
    messageInput.focus();
  }
}

function checkForAuthToken() {
  const hashParams = new URLSearchParams(location.hash.substring(1));
  const token = hashParams.get("token");

  if (token) {
    accessToken = token;
    // Clear the token from the URL
    updateStatus("Authenticated successfully!");
  }
}

// Auto-resize textarea
const messageInput = document.getElementById("messageInput");
messageInput?.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = this.scrollHeight + "px";
});

async function handleStreamingResponse(message: string) {
  // Get last 20 messages for context (40 total with responses)
  const recentHistory = conversationHistory.slice(-20);

  const requestBody = {
    model: "cheapest",
    messages: recentHistory,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Redirect: window.location.pathname || "/",
  };

  // Add authorization header if we have a token
  if (accessToken) {
    headers["Authorization"] = accessToken;
  }

  const response = await fetch(`${API_URL}/api/chat/stream`, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(requestBody),
  });

  // Handle payment required (need authentication)
  if (!response.ok) {
    const location = response.headers.get("Location");
    if (location) {
      addMessage("system", "Redirecting to authenticate...");
      window.location.href = location;
      return;
    }

    const errorText = await response.text();
    throw new Error(`Chat request failed: ${response.status} - ${errorText}`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let assistantMessage = "";
  let messageElement: HTMLDivElement | null = null;

  let handledModel = "";

  const readStreamChunk = async () => {
    const { value, done } = await reader!.read();

    if (done) {
      return;
    }

    const decoded = decoder.decode(value, { stream: true });
    const lines = decoded.split("\n");

    for (const line of lines) {
      if (line.trim() !== "") {
        try {
          const data = JSON.parse(line);

          // Check if this is a credits message (final message)
          if (data.Credits !== undefined) {
            const creditInfo = `Credits used: ${data.Credits}`;
            updateStatus(creditInfo);
            continue;
          }

          if (data.model) {
            handledModel = data.model;
          }

          // Handle regular streaming message
          if (data.message && data.message.content) {
            assistantMessage += data.message.content;

            // Create or update the assistant message element
            if (!messageElement) {
              showTypingIndicator(false);
              messageElement = addMessage(
                "assistant",
                assistantMessage,
                true,
                handledModel
              );
            } else {
              updateMessageContent(messageElement, assistantMessage);
            }
          }
        } catch (error) {
          console.warn("Error parsing streaming response:", line, error);
        }
      }
    }

    // Continue reading
    await readStreamChunk();
  };

  await readStreamChunk();

  // Add final assistant message to history and save
  if (assistantMessage) {
    conversationHistory.push({
      role: "assistant",
      content: assistantMessage,
      model: handledModel,
    });
    saveConversationToStorage();
  }
}

function addMessage(
  role: string,
  content: string,
  returnElement = false,
  model?: string
): HTMLDivElement | null {
  const messagesContainer = document.getElementById("messages");
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${role}`;

  const messageContent = document.createElement("div");
  messageContent.className = "message-content";
  messageContent.textContent = content;

  messageDiv.appendChild(messageContent);

  // Add model indicator for assistant messages
  if (role === "assistant" && model) {
    const modelIndicator = document.createElement("div");
    modelIndicator.className = "model-indicator";
    modelIndicator.textContent = `${model}`;
    messageDiv.appendChild(modelIndicator);
  }

  if (!messagesContainer) return null;
  messagesContainer.appendChild(messageDiv);

  // Scroll to bottom
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  if (returnElement) {
    return messageDiv;
  }
  return null;
}

function updateMessageContent(
  messageElement: HTMLDivElement,
  newContent: string
) {
  const messageContent = messageElement.querySelector(".message-content");
  if (!messageContent) return;
  messageContent.textContent = newContent;

  // Scroll to bottom
  const messagesContainer = document.getElementById("messages");
  if (!messagesContainer) return;
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function updateStatus(message: string) {
  const statusElement = document.getElementById("status");
  if (!statusElement) return;

  statusElement.textContent = message;

  // Clear status after 3 seconds
  setTimeout(() => {
    statusElement.textContent = "";
  }, 3000);
}

function showTypingIndicator(show: boolean) {
  const typingIndicator = document.getElementById("typingIndicator");
  if (show) {
    typingIndicator?.classList.add("show");
  } else {
    typingIndicator?.classList.remove("show");
  }

  // Scroll to bottom when showing/hiding
  const messagesContainer = document.getElementById("messages");
  setTimeout(() => {
    if (!messagesContainer) return;
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }, 100);
}

function saveConversationToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversationHistory));
  } catch (error) {
    console.warn("Failed to save conversation to localStorage:", error);
  }
}

function loadConversationFromStorage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      conversationHistory = JSON.parse(stored);

      // Clear existing messages except system message
      const messagesContainer = document.getElementById("messages");
      if (messagesContainer) {
        const systemMessage =
          messagesContainer.querySelector(".message.system");
        messagesContainer.innerHTML = "";
        if (systemMessage) {
          messagesContainer.appendChild(systemMessage);
        }
      }

      // Recreate messages from history
      conversationHistory.forEach((msg) => {
        addMessage(msg.role, msg.content, false, msg.model);
      });
    }
  } catch (error) {
    console.warn("Failed to load conversation from localStorage:", error);
    conversationHistory = [];
  }
}

function clearConversation() {
  if (confirm("Are you sure you want to clear the conversation?")) {
    conversationHistory = [];
    localStorage.removeItem(STORAGE_KEY);

    // Clear messages except system message
    const messagesContainer = document.getElementById("messages");
    if (messagesContainer) {
      const systemMessage = messagesContainer.querySelector(".message.system");
      messagesContainer.innerHTML = "";
      if (systemMessage) {
        messagesContainer.appendChild(systemMessage);
      }
    }

    updateStatus("Conversation cleared");
  }
}
