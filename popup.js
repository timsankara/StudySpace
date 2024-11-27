// State management and configuration
const APP_STATE = {
  currentTab: "summary",
  isProcessing: false,
  flashcards: [],
  currentCardIndex: 0,
  maxTokenLength: 1024,
  processingTimeoutMs: 30000,
};

// DOM Element cache for performance
const UI = (() => {
  const elements = new Map();

  const selectors = {
    // Tab elements
    tabButtons: ".tab-btn",
    tabPanels: ".tab-panel",

    // Action buttons
    summarizeBtn: "summarize-selected",
    generateCardsBtn: "generate-cards",
    generateQuizBtn: "generate-quiz",
    prevCardBtn: "prev-card",
    nextCardBtn: "next-card",

    // Content areas
    summaryText: "summary-text",
    questionText: "question-text",
    quizOptions: "quiz-options",

    // Flashcard elements
    flashcardFront: ".flashcard-front p",
    flashcardBack: ".flashcard-back p",
    cardCounter: ".card-counter",

    // Status elements
    progressBar: ".progress",
    statusText: ".status",
  };

  function initialize() {
    // Initialize multiple elements
    elements.set("tabButtons", document.querySelectorAll(selectors.tabButtons));
    elements.set("tabPanels", document.querySelectorAll(selectors.tabPanels));

    // Initialize single elements
    for (const [key, selector] of Object.entries(selectors)) {
      if (key !== "tabButtons" && key !== "tabPanels") {
        const element = selector.startsWith(".")
          ? document.querySelector(selector)
          : document.getElementById(selector);

        if (element) {
          elements.set(key, element);
        }
      }
    }
  }

  function get(elementKey) {
    return elements.get(elementKey);
  }

  return { initialize, get };
})();

// Tab Management
function switchTab(tabId) {
  if (APP_STATE.isProcessing || APP_STATE.currentTab === tabId) return;

  APP_STATE.currentTab = tabId;

  UI.get("tabButtons").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabId);
  });

  UI.get("tabPanels").forEach((panel) => {
    panel.classList.toggle("active", panel.id === tabId);
  });

  if (tabId === "flashcards") {
    updateFlashcardDisplay();
  }

  chrome.storage.local.set({ currentTab: tabId });
}

// Text Processing
async function handleSummarize() {
  if (APP_STATE.isProcessing) return;

  try {
    APP_STATE.isProcessing = true;
    updateStatus("Getting selected text...", 10);

    const selectedText = await getSelectedText();
    if (!selectedText) {
      throw new Error("Please select text to summarize");
    }

    updateStatus("Processing text...", 30);
    UI.get("summaryText").textContent = "Generating summary...";

    const result = await processWithTimeout(
      sendMessage({ type: "processText", text: selectedText }),
      APP_STATE.processingTimeoutMs,
      "Summary generation timed out",
    );

    if (!result.success) {
      throw new Error(result.error);
    }

    UI.get("summaryText").textContent = result.summary;
    await chrome.storage.local.set({
      lastSummary: result.summary,
      timestamp: Date.now(),
    });

    updateStatus("Summary created!", 100);
  } catch (error) {
    handleError("Summarization failed", error);
  } finally {
    APP_STATE.isProcessing = false;
  }
}

// Flashcard Management
async function handleGenerateFlashcards() {
  if (APP_STATE.isProcessing) return;

  try {
    APP_STATE.isProcessing = true;
    updateStatus("Preparing flashcards...", 20);

    const { lastSummary } = await chrome.storage.local.get("lastSummary");
    if (!lastSummary) {
      throw new Error("Please create a summary first");
    }

    const result = await processWithTimeout(
      sendMessage({ type: "generateFlashcards", summary: lastSummary }),
      APP_STATE.processingTimeoutMs,
      "Flashcard generation timed out",
    );

    if (!result.success) {
      throw new Error(result.error);
    }

    await chrome.storage.local.set({
      currentFlashcards: result.flashcards,
      currentCardIndex: 0,
    });

    APP_STATE.flashcards = result.flashcards;
    APP_STATE.currentCardIndex = 0;

    updateFlashcardDisplay();
    updateStatus("Flashcards ready!", 100);
  } catch (error) {
    handleError("Flashcard generation failed", error);
  } finally {
    APP_STATE.isProcessing = false;
  }
}

function updateFlashcardDisplay() {
  chrome.storage.local.get(
    ["currentFlashcards", "currentCardIndex"],
    (data) => {
      const flashcards = data.currentFlashcards || [];
      const currentIndex = data.currentCardIndex || 0;

      if (!flashcards.length) {
        setFlashcardContent(
          "Generate flashcards to begin studying",
          "Click the button above",
          "No cards available",
        );
        setNavigationState(true);
        return;
      }

      const card = flashcards[currentIndex];
      setFlashcardContent(
        card.question,
        card.answer,
        `Card ${currentIndex + 1} of ${flashcards.length}`,
      );
      setNavigationState(flashcards.length <= 1);
    },
  );
}

function navigateFlashcards(direction) {
  chrome.storage.local.get(
    ["currentFlashcards", "currentCardIndex"],
    (data) => {
      const flashcards = data.currentFlashcards || [];
      if (!flashcards.length) return;

      const newIndex =
        direction === "prev"
          ? (data.currentCardIndex - 1 + flashcards.length) % flashcards.length
          : (data.currentCardIndex + 1) % flashcards.length;

      chrome.storage.local.set({ currentCardIndex: newIndex }, () => {
        APP_STATE.currentCardIndex = newIndex;
        updateFlashcardDisplay();
      });
    },
  );
}

// Quiz Management
async function handleGenerateQuiz() {
  if (APP_STATE.isProcessing) return;

  try {
    APP_STATE.isProcessing = true;
    updateStatus("Preparing quiz...", 20);

    const { lastSummary } = await chrome.storage.local.get("lastSummary");
    if (!lastSummary) {
      throw new Error("Please create a summary first");
    }

    const result = await processWithTimeout(
      sendMessage({ type: "generateQuiz", summary: lastSummary }),
      APP_STATE.processingTimeoutMs,
      "Quiz generation timed out",
    );

    if (!result.success) {
      throw new Error(result.error);
    }

    displayQuiz(result.quiz);
    updateStatus("Quiz ready!", 100);
  } catch (error) {
    handleError("Quiz generation failed", error);
  } finally {
    APP_STATE.isProcessing = false;
  }
}

// Utility Functions
async function getSelectedText() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab?.id) {
      throw new Error("No active tab found");
    }

    const [selection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: () => window.getSelection()?.toString() || "",
    });

    return selection?.result?.trim() || "";
  } catch (error) {
    console.error("Text selection error:", error);
    throw new Error("Unable to get selected text");
  }
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

async function processWithTimeout(promise, timeoutMs, timeoutMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    }),
  ]);
}

function handleError(context, error) {
  console.error(`${context}:`, error);
  updateStatus(`Error: ${error.message}`, 0);

  switch (APP_STATE.currentTab) {
    case "summary":
      UI.get("summaryText").textContent = error.message;
      break;
    case "flashcards":
      setFlashcardContent("Error", error.message, "Error occurred");
      break;
    case "quiz":
      UI.get("questionText").textContent = error.message;
      UI.get("quizOptions").innerHTML = "";
      break;
  }
}

function updateStatus(message, progress = 0) {
  UI.get("statusText").textContent = message;
  UI.get("progressBar").style.width = `${progress}%`;
}

function setFlashcardContent(front, back, counter) {
  UI.get("flashcardFront").textContent = front;
  UI.get("flashcardBack").textContent = back;
  UI.get("cardCounter").textContent = counter;
}

function setNavigationState(disabled) {
  UI.get("prevCardBtn").disabled = disabled;
  UI.get("nextCardBtn").disabled = disabled;
}

function displayQuiz(quiz) {
  UI.get("questionText").textContent = quiz.question;
  const optionsContainer = UI.get("quizOptions");
  optionsContainer.innerHTML = "";

  quiz.options.forEach((option, index) => {
    const button = document.createElement("button");
    button.className = "option-btn";
    button.textContent = `${String.fromCharCode(65 + index)}) ${option}`;
    button.addEventListener("click", () => handleQuizAnswer(index, quiz));
    optionsContainer.appendChild(button);
  });
}

function handleQuizAnswer(selectedIndex, quiz) {
  const buttons = UI.get("quizOptions").querySelectorAll(".option-btn");
  buttons.forEach((btn) => (btn.disabled = true));

  const isCorrect = selectedIndex === quiz.correctIndex;
  buttons[selectedIndex].classList.add(isCorrect ? "correct" : "incorrect");

  if (!isCorrect) {
    buttons[quiz.correctIndex].classList.add("correct");
  }

  if (quiz.explanation) {
    const explanation = document.createElement("div");
    explanation.className = "quiz-explanation";
    explanation.textContent = quiz.explanation;
    UI.get("quizOptions").appendChild(explanation);
  }

  updateStatus(isCorrect ? "Correct!" : "Try another question!");
}

// Initialization
document.addEventListener("DOMContentLoaded", () => {
  UI.initialize();

  // Set up event listeners
  UI.get("tabButtons").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  UI.get("summarizeBtn").addEventListener("click", handleSummarize);
  UI.get("generateCardsBtn").addEventListener(
    "click",
    handleGenerateFlashcards,
  );
  UI.get("generateQuizBtn").addEventListener("click", handleGenerateQuiz);
  UI.get("prevCardBtn").addEventListener("click", () =>
    navigateFlashcards("prev"),
  );
  UI.get("nextCardBtn").addEventListener("click", () =>
    navigateFlashcards("next"),
  );

  // Message listener for streaming updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "summaryProgress" && message.text) {
      UI.get("summaryText").textContent = message.text;
      updateStatus("Generating summary...", 70);
    }
  });

  // Load saved state
  chrome.storage.local.get(["currentTab", "currentFlashcards"], (data) => {
    if (data.currentTab) {
      switchTab(data.currentTab);
    }
    if (data.currentFlashcards) {
      updateFlashcardDisplay();
    }
  });
});
