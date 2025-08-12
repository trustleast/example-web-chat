import "./styles.css"; // We will populate this file in next sub-chapter

const API_URL = "https://api.peerwave.ai";
let accessToken: string | null = null;

// Check for token in URL fragment on page load
window.addEventListener("load", function () {
  checkForAuthToken();
  const form = document.querySelector("form");
  form?.addEventListener("submit", sendMessage);
});

async function sendMessage(e: Event) {
  e.preventDefault();
  const messageInput: HTMLInputElement | null = document.getElementById(
    "messageInput"
  ) as HTMLInputElement;
  const sendButton = document.getElementById("sendButton") as HTMLButtonElement;
  const message = messageInput?.value.trim();

  if (!message) return;

  // Add user message to chat
  addMessage("user", message);

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
  const requestBody = {
    model: "cheapest",
    messages: [
      {
        role: "user",
        content: message,
      },
    ],
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
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Chat request failed: ${response.status} - ${errorText}`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let assistantMessage = "";
  let messageElement: HTMLDivElement | null = null;

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

          // Handle regular streaming message
          if (data.message && data.message.content) {
            assistantMessage += data.message.content;

            // Create or update the assistant message element
            if (!messageElement) {
              showTypingIndicator(false);
              messageElement = addMessage("assistant", assistantMessage, true);
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
}

function addMessage(
  role: string,
  content: string,
  returnElement = false
): HTMLDivElement | null {
  const messagesContainer = document.getElementById("messages");
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${role}`;

  const messageContent = document.createElement("div");
  messageContent.className = "message-content";
  messageContent.textContent = content;

  messageDiv.appendChild(messageContent);
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
