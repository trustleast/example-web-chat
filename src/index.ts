import "./styles.css"; // We will populate this file in next sub-chapter

const API_URL = "https://local.api.peerwave.ai:8080";
let accessToken: string | null = null;
let conversationHistory: Array<{
  role: string;
  content: string;
  model?: string;
}> = [];
let currentModel = "cheapest";
const STORAGE_KEY = "peerwave_conversation";
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000; // 1 second base delay

// Check for token in URL fragment on page load
window.addEventListener("load", function () {
  loadConversationFromStorage();
  checkForAuthToken();
  const form = document.querySelector("form");
  form?.addEventListener("submit", sendMessage);
  const clearButton = document.getElementById("clearButton");
  clearButton?.addEventListener("click", clearConversation);

  // Set up mobile viewport handling
  setupMobileViewport();
});

async function sendMessage(e: Event) {
  e.preventDefault();
  const messageInput: HTMLInputElement | null = document.getElementById(
    "messageInput"
  ) as HTMLInputElement;
  const message = messageInput?.value.trim();

  if (!message) return;

  // Add user message to chat and history
  addMessage("user", message);
  conversationHistory.push({ role: "user", content: message });
  saveConversationToStorage();

  await sendWrapper();
}

async function sendWrapper() {
  const messageInput: HTMLInputElement | null = document.getElementById(
    "messageInput"
  ) as HTMLInputElement;
  const sendButton = document.getElementById("sendButton") as HTMLButtonElement;

  // Clear input and disable sending
  messageInput.value = "";
  messageInput.style.height = "auto";
  sendButton.disabled = true;
  messageInput.disabled = true;

  // Show typing indicator
  showTypingIndicator(true);

  try {
    const success = await handleStreamingResponseWithRetry();
    if (!success) {
      if (
        conversationHistory.length > 0 &&
        conversationHistory[conversationHistory.length - 1].role === "user"
      ) {
        conversationHistory.pop();
        saveConversationToStorage();
      }
    }
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

    // Auto-retry if last message is from user and no assistant response
    if (conversationHistory.length === 0) return;

    const lastMessage = conversationHistory[conversationHistory.length - 1];
    if (lastMessage.role === "user") {
      // Found a user message without an assistant response, auto-retry
      updateStatus("Retrying last message after authentication...");
      setTimeout(() => {
        sendWrapper();
      }, 50);
    }
  }
}

// Auto-resize textarea
const messageInput = document.getElementById("messageInput");
messageInput?.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = this.scrollHeight + "px";
});

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleStreamingResponseWithRetry(
  attemptNumber = 1
): Promise<boolean> {
  const success = await handleStreamingResponse();
  if (success) {
    return true;
  }

  if (attemptNumber < MAX_RETRY_ATTEMPTS) {
    const delay = RETRY_DELAY * Math.pow(2, attemptNumber - 1); // Exponential backoff
    updateStatus(
      `Request failed, retrying in ${
        delay / 1000
      }s... (${attemptNumber}/${MAX_RETRY_ATTEMPTS})`
    );
    await sleep(delay);
    return handleStreamingResponseWithRetry(attemptNumber + 1);
  }

  updateStatus("Request failed after maximum retries");

  return false;
}

async function handleStreamingResponse(): Promise<boolean> {
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

  if (!response.ok) {
    const location = response.headers.get("Location");
    if (location) {
      addMessage("system", "Redirecting to authenticate...");
      window.location.href = location;
      return true;
    }

    return false;
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let assistantMessage = "";
  let messageElement: HTMLDivElement | null = null;

  let handledModel = "";

  const readStreamChunk = async () => {
    const { value, done } = await reader!.read();

    if (done) {
      return true;
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

  return true;
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

  // Check if we need to scroll to maintain bottom position
  const wasAtBottom =
    messagesContainer.scrollTop >=
    messagesContainer.scrollHeight - messagesContainer.clientHeight - 1;

  messagesContainer.appendChild(messageDiv);

  // Only auto-scroll if user was already at the bottom
  if (wasAtBottom) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

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

  // Check if we need to scroll to maintain bottom position
  const messagesContainer = document.getElementById("messages");
  if (!messagesContainer) return;

  const wasAtBottom =
    messagesContainer.scrollTop >=
    messagesContainer.scrollHeight - messagesContainer.clientHeight - 1;

  // Only auto-scroll if user was already at the bottom
  if (wasAtBottom) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
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

  // Scroll to bottom when showing/hiding if user was already at bottom
  const messagesContainer = document.getElementById("messages");
  setTimeout(() => {
    if (!messagesContainer) return;
    const wasAtBottom =
      messagesContainer.scrollTop >=
      messagesContainer.scrollHeight - messagesContainer.clientHeight - 1;

    if (wasAtBottom || show) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
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

      // Clear existing messages
      const messagesContainer = document.getElementById("messages");
      if (messagesContainer) {
        messagesContainer.innerHTML = "";
      }

      // Add system message if no conversation history
      if (conversationHistory.length === 0) {
        addSystemWelcomeMessage();
      } else {
        // Recreate messages from history
        conversationHistory.forEach((msg) => {
          addMessage(msg.role, msg.content, false, msg.model);
        });
      }

      // Ensure we start at the bottom after loading
      setTimeout(() => {
        if (messagesContainer) {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
      }, 100);
    } else {
      // No stored conversation, add welcome message
      addSystemWelcomeMessage();
    }
  } catch (error) {
    console.warn("Failed to load conversation from localStorage:", error);
    conversationHistory = [];
    addSystemWelcomeMessage();
  }
}

function addSystemWelcomeMessage() {
  const messagesContainer = document.getElementById("messages");
  if (messagesContainer) {
    const systemMessage = document.createElement("div");
    systemMessage.className = "message system";
    const messageContent = document.createElement("div");
    messageContent.className = "message-content";
    messageContent.textContent =
      "Welcome! Start chatting with AI models on the Peerwave network. Your first few messages are free!";
    systemMessage.appendChild(messageContent);
    messagesContainer.appendChild(systemMessage);
  }
}

function clearConversation() {
  // if (confirm("Are you sure you want to clear the conversation?")) {
  conversationHistory = [];
  localStorage.removeItem(STORAGE_KEY);

  // Clear messages and add welcome message
  const messagesContainer = document.getElementById("messages");
  if (messagesContainer) {
    messagesContainer.innerHTML = "";
    addSystemWelcomeMessage();
  }

  updateStatus("Conversation cleared");
  // }
}

function setupMobileViewport() {
  // Handle viewport height changes for mobile keyboards
  function updateViewportHeight() {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty("--vh", `${vh}px`);
  }

  // Initial setup
  updateViewportHeight();

  // Listen for viewport changes (mobile keyboard, rotation)
  window.addEventListener("resize", updateViewportHeight);
  window.addEventListener("orientationchange", () => {
    setTimeout(updateViewportHeight, 100);
  });

  // Handle input focus/blur for better mobile experience
  const messageInput = document.getElementById(
    "messageInput"
  ) as HTMLInputElement;
  if (messageInput) {
    messageInput.addEventListener("focus", () => {
      // Ensure input stays visible by scrolling messages container
      if (window.innerWidth <= 768) {
        const messagesContainer = document.getElementById("messages");
        if (messagesContainer) {
          setTimeout(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
          }, 300);
        }
      }
    });

    messageInput.addEventListener("blur", () => {
      setTimeout(updateViewportHeight, 300);
    });
  }

  // Prevent zoom on input focus for iOS
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
    const viewport = document.querySelector(
      "meta[name=viewport]"
    ) as HTMLMetaElement;
    if (viewport) {
      viewport.content =
        "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no";
    }
  }
}
