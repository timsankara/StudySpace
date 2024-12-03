// AI Session and Configuration
let aiSession = null;
const CONFIG = {
  maxTokens: 1024,
  processingTimeout: 30000,
  systemPrompt: `You are an expert study assistant specializing in clear, concise summaries.
    Focus on identifying and explaining key concepts accurately and succinctly.`,
};

// Initialize AI capabilities
async function initializeAI() {
  try {
    if (!chrome.aiOriginTrial?.languageModel) {
      throw new Error("Chrome AI API not available");
    }

    const capabilities =
      await chrome.aiOriginTrial.languageModel.capabilities();
    if (capabilities.available === "no") {
      throw new Error("AI features not available on this device");
    }

    aiSession = await chrome.aiOriginTrial.languageModel.create({
      temperature: capabilities.defaultTemperature,
      topK: capabilities.defaultTopK,
      systemPrompt: CONFIG.systemPrompt,
    });

    return true;
  } catch (error) {
    console.error("AI initialization error:", error);
    return false;
  }
}

// Message Handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handlers = {
    processText: () => handleTextProcessing(message.text, sendResponse),
    generateFlashcards: () =>
      handleFlashcardGeneration(message.summary, sendResponse),
    generateQuiz: () => handleQuizGeneration(message.summary, sendResponse),
    checkAIStatus: () => handleAIStatus(sendResponse),
    cleanup: () => cleanup(),
  };

  const handler = handlers[message.type];
  if (handler) {
    handler();
    return true; // Keep message channel open
  }
});

// Text Processing
async function handleTextProcessing(text, sendResponse) {
  try {
    if (!aiSession && !(await initializeAI())) {
      throw new Error("AI initialization failed");
    }

    const tokenCount = await aiSession.countPromptTokens(text);
    if (tokenCount > CONFIG.maxTokens) {
      throw new Error(
        "Oops! The text you selected is a bit too long. Try selecting a smaller section to continue",
      );
    }

    const prompt = `
            Create a clear, structured summary of the following text:

            ${text}

            Format the summary using this markdown structure:
            # Overview
            A brief introduction of the main topic (2-3 sentences)

            ## Key Points
            - First main point
            - Second main point
            - Third main point

            ## Important Details
            - Notable detail 1
            - Notable detail 2
            - Notable detail 3

            Keep the summary focused and concise. Use clear language.
        `;

    const stream = await aiSession.promptStreaming(prompt);
    let result = "";
    let previousChunk = "";

    for await (const chunk of stream) {
      const newChunk = chunk.startsWith(previousChunk)
        ? chunk.slice(previousChunk.length)
        : chunk;
      result += newChunk;
      previousChunk = chunk;

      // Send progress updates
      try {
        chrome.runtime.sendMessage({
          type: "summaryProgress",
          text: result,
        });
      } catch (e) {} // Ignore if popup is closed
    }

    sendResponse({ success: true, summary: result });
  } catch (error) {
    console.error("Text processing error:", error);
    sendResponse({ success: false, error: error.message });
  }
}

// Flashcard Generation
async function handleFlashcardGeneration(summary, sendResponse) {
  try {
    if (!aiSession && !(await initializeAI())) {
      throw new Error("AI initialization failed");
    }

    const flashcardSession = await aiSession.clone();
    const prompt = `
            Create 5 study flashcards from this summary:
            ${summary}

            Rules:
            1. Focus on key concepts and relationships
            2. Test understanding, not just memorization
            3. Keep questions clear and answers concise

            Format exactly as:
            Q: [question]
            A: [answer]
            ---
        `;

    const stream = await flashcardSession.promptStreaming(prompt);
    let result = "";
    let previousChunk = "";

    for await (const chunk of stream) {
      const newChunk = chunk.startsWith(previousChunk)
        ? chunk.slice(previousChunk.length)
        : chunk;
      result += newChunk;
      previousChunk = chunk;
    }

    const flashcards = parseFlashcards(result);
    flashcardSession.destroy();
    sendResponse({ success: true, flashcards });
  } catch (error) {
    console.error("Flashcard generation error:", error);
    sendResponse({ success: false, error: error.message });
  }
}

// Quiz Generation
async function handleQuizGeneration(summary, sendResponse) {
  try {
    if (!aiSession && !(await initializeAI())) {
      throw new Error("AI initialization failed");
    }

    const quizSession = await aiSession.clone();
    const prompt = `
            Create a multiple-choice question based on this summary:
            ${summary}

            Guidelines:
            1. Question should test understanding
            2. All options should be plausible
            3. Include explanation for correct answer

            Format exactly as:
            Q: [question]
            A) [option1]
            B) [option2]
            C) [option3]
            D) [option4]
            Correct: [A/B/C/D]
            Explanation: [brief explanation]
        `;

    const stream = await quizSession.promptStreaming(prompt);
    let result = "";
    let previousChunk = "";

    for await (const chunk of stream) {
      const newChunk = chunk.startsWith(previousChunk)
        ? chunk.slice(previousChunk.length)
        : chunk;
      result += newChunk;
      previousChunk = chunk;
    }

    const quiz = parseQuiz(result);
    quizSession.destroy();
    sendResponse({ success: true, quiz });
  } catch (error) {
    console.error("Quiz generation error:", error);
    sendResponse({ success: false, error: error.message });
  }
}

// Utility Functions
function parseFlashcards(text) {
  return text
    .split("---")
    .map((card) => card.trim())
    .filter((card) => card)
    .map((card) => {
      const [question, answer] = card.split("\nA:");
      return {
        question: question.replace("Q:", "").trim(),
        answer: answer.trim(),
      };
    });
}

function parseQuiz(text) {
  const lines = text.split("\n").map((l) => l.trim());
  return {
    question: lines[0].replace("Q:", "").trim(),
    options: lines.slice(1, 5).map((l) => l.substring(2).trim()),
    correctIndex: "ABCD".indexOf(lines[5].replace("Correct:", "").trim()),
    explanation: lines[6].replace("Explanation:", "").trim(),
  };
}

function cleanup() {
  if (aiSession) {
    aiSession.destroy();
    aiSession = null;
  }
}

// Cleanup on extension suspend
chrome.runtime.onSuspend.addListener(cleanup);
