import { formatSummaryText as formatText } from "./utils.js";

// State and Configuration
const APP_STATE = {
  currentTab: "summary",
  isProcessing: false,
  currentCardIndex: 0,
  processingTimeoutMs: 30000,
};

// DOM Element Cache
const UI = {
  elements: new Map(),
  selectors: {
    tabButtons: ".tab-btn",
    tabPanels: ".tab-panel",
    summarizeBtn: "summarize-selected",
    generateCardsBtn: "generate-cards",
    generateQuizBtn: "generate-quiz",
    prevCardBtn: "prev-card",
    nextCardBtn: "next-card",
    summaryText: "summary-text",
    questionText: "question-text",
    quizOptions: "quiz-options",
    flashcardFront: ".flashcard-front p",
    flashcardBack: ".flashcard-back p",
    cardCounter: ".card-counter",
    progressBar: ".progress",
    statusText: ".status",
  },
};

// Initialize DOM elements and event listeners
function initializeUI() {
  for (const [key, selector] of Object.entries(UI.selectors)) {
    if (selector.startsWith(".")) {
      if (["tabButtons", "tabPanels"].includes(key)) {
        UI.elements.set(key, document.querySelectorAll(selector));
      } else {
        UI.elements.set(key, document.querySelector(selector));
      }
    } else {
      UI.elements.set(key, document.getElementById(selector));
    }
  }

  // Tab navigation
  UI.elements.get("tabButtons").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  // Action buttons
  UI.elements.get("summarizeBtn").addEventListener("click", handleSummarize);
  UI.elements
    .get("generateCardsBtn")
    .addEventListener("click", handleGenerateFlashcards);
  UI.elements
    .get("generateQuizBtn")
    .addEventListener("click", handleGenerateQuiz);
  UI.elements
    .get("prevCardBtn")
    .addEventListener("click", () => navigateFlashcards("prev"));
  UI.elements
    .get("nextCardBtn")
    .addEventListener("click", () => navigateFlashcards("next"));
}

// Text Selection and Processing
async function handleSummarize() {
  if (APP_STATE.isProcessing) return;

  try {
    APP_STATE.isProcessing = true;
    updateStatus("Getting selected text...", 10);

    const selectedText = await getSelectedText();
    if (!selectedText) {
      throw new Error("Please select text to summarize");
    }

    updateStatus("Generating summary...", 30);
    UI.elements.get("summaryText").innerHTML =
      '<div class="loading">Processing...</div>';

    const result = await processWithTimeout(
      sendMessage({ type: "processText", text: selectedText }),
      APP_STATE.processingTimeoutMs,
    );

    if (!result.success) {
      throw new Error(result.error);
    }

    const formattedSummary = formatText(result.summary);
    UI.elements.get('summaryText').innerHTML = formattedSummary;

    await chrome.storage.local.set({
      lastSummary: result.summary,
      timestamp: Date.now(),
    });

    updateStatus("Summary created!", 100);
  } catch (error) {
    handleError("Summary generation failed", error);
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
    );

    if (!result.success) {
      throw new Error(result.error);
    }

    await chrome.storage.local.set({
      currentFlashcards: result.flashcards,
      currentCardIndex: 0,
    });

    APP_STATE.currentCardIndex = 0;
    updateFlashcardDisplay();
    updateStatus("Flashcards ready!", 100);
  } catch (error) {
    handleError("Flashcard generation failed", error);
  } finally {
    APP_STATE.isProcessing = false;
  }
}

async function navigateFlashcards(direction) {
  try {
    const { currentFlashcards } =
      await chrome.storage.local.get("currentFlashcards");
    if (!currentFlashcards?.length) return;

    const totalCards = currentFlashcards.length;
    APP_STATE.currentCardIndex =
      direction === "prev"
        ? (APP_STATE.currentCardIndex - 1 + totalCards) % totalCards
        : (APP_STATE.currentCardIndex + 1) % totalCards;

    await chrome.storage.local.set({
      currentCardIndex: APP_STATE.currentCardIndex,
    });
    updateFlashcardDisplay();
  } catch (error) {
    handleError("Navigation failed", error);
  }
}

// Quiz Management
async function handleGenerateQuiz() {
  if (APP_STATE.isProcessing) return;

  try {
    APP_STATE.isProcessing = true;
    updateStatus("Generating quiz...", 20);

    const { lastSummary } = await chrome.storage.local.get("lastSummary");
    if (!lastSummary) {
      throw new Error("Please create a summary first");
    }

    const result = await processWithTimeout(
      sendMessage({ type: "generateQuiz", summary: lastSummary }),
      APP_STATE.processingTimeoutMs,
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

// UI Updates
function updateFlashcardDisplay() {
  chrome.storage.local.get(
    ["currentFlashcards", "currentCardIndex"],
    (data) => {
      const flashcards = data.currentFlashcards || [];
      const currentIndex = APP_STATE.currentCardIndex;

      if (!flashcards.length) {
        setFlashcardContent(
          "No flashcards available",
          "Generate flashcards to begin studying",
          "No cards yet",
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

function displayQuiz(quiz) {
  UI.elements.get("questionText").textContent = quiz.question;
  const optionsContainer = UI.elements.get("quizOptions");
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
  const buttons = UI.elements
    .get("quizOptions")
    .querySelectorAll(".option-btn");
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
    UI.elements.get("quizOptions").appendChild(explanation);
  }

  updateStatus(isCorrect ? "Correct!" : "Try another question!");
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

    return selection?.result?.trim();
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

function processWithTimeout(promise, timeout) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Operation timed out")), timeout),
    ),
  ]);
}

function switchTab(tabId) {
  if (APP_STATE.isProcessing || APP_STATE.currentTab === tabId) return;

  APP_STATE.currentTab = tabId;

  UI.elements.get("tabButtons").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabId);
  });

  UI.elements.get("tabPanels").forEach((panel) => {
    panel.classList.toggle("active", panel.id === tabId);
  });

  if (tabId === "flashcards") {
    updateFlashcardDisplay();
  }

  chrome.storage.local.set({ currentTab: tabId });
}

function updateStatus(message, progress = 0) {
  UI.elements.get("statusText").textContent = message;
  UI.elements.get("progressBar").style.width = `${progress}%`;
}

function setFlashcardContent(front, back, counter) {
  UI.elements.get("flashcardFront").textContent = front;
  UI.elements.get("flashcardBack").textContent = back;
  UI.elements.get("cardCounter").textContent = counter;
}

function setNavigationState(disabled) {
  UI.elements.get("prevCardBtn").disabled = disabled;
  UI.elements.get("nextCardBtn").disabled = disabled;
}

function handleError(context, error) {
  console.error(`${context}:`, error);
  updateStatus(`Error: ${error.message}`, 0);

  switch (APP_STATE.currentTab) {
    case "summary":
      UI.elements.get("summaryText").textContent = error.message;
      break;
    case "flashcards":
      setFlashcardContent("Error", error.message, "Error occurred");
      break;
    case "quiz":
      UI.elements.get("questionText").textContent = error.message;
      UI.elements.get("quizOptions").innerHTML = "";
      break;
  }
}

// Initialize extension
document.addEventListener("DOMContentLoaded", () => {
  initializeUI();

  // Load saved state
  chrome.storage.local.get(["currentTab", "currentFlashcards"], (data) => {
    if (data.currentTab) {
      switchTab(data.currentTab);
    }
    if (data.currentFlashcards) {
      updateFlashcardDisplay();
    }
  });

  // Listen for streaming updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "summaryProgress" && message.text) {
      const formattedProgress = formatText(message.text);
      UI.elements.get("summaryText").innerHTML = formattedProgress;
      updateStatus("Generating summary...", 70);
    }
  });
});
