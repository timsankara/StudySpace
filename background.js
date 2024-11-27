let aiSession = null;

async function initializeAI() {
  try {
    if (!chrome.aiOriginTrial?.languageModel) {
      throw new Error(
        "Chrome AI API not available. Enable the Origin Trial flag.",
      );
    }

    const capabilities =
      await chrome.aiOriginTrial.languageModel.capabilities();
    console.log("AI Capabilities:", capabilities);

    if (capabilities.available === "no") {
      throw new Error("AI features not available on this device");
    }

    aiSession = await chrome.aiOriginTrial.languageModel.create({
      temperature: capabilities.defaultTemperature,
      topK: capabilities.defaultTopK,
      systemPrompt: `You are a specialized study assistant that excels at:
                1. Creating clear, concise summaries
                2. Generating effective study flashcards
                3. Creating challenging but fair quiz questions
                Always format your responses clearly and maintain a helpful, educational tone.`,
    });

    return true;
  } catch (error) {
    console.error("AI initialization error:", error);
    console.log("Chrome Logged: ", chrome);
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "checkAIStatus":
      handleAIStatus(sendResponse);
      break;
    case "processText":
      handleTextProcessing(message.text, sendResponse);
      break;
    case "generateFlashcards":
      handleFlashcardGeneration(message.summary, sendResponse);
      break;
    case "generateQuiz":
      handleQuizGeneration(message.summary, sendResponse);
      break;
    case "cleanup":
      cleanup();
      break;
  }
  return true;
});

async function handleAIStatus(sendResponse) {
  try {
    if (!chrome.aiOriginTrial?.languageModel) {
      throw new Error("AI API not available");
    }

    const capabilities =
      await chrome.aiOriginTrial.languageModel.capabilities();
    sendResponse({
      success: true,
      available: capabilities.available,
      defaults: {
        temperature: capabilities.defaultTemperature,
        topK: capabilities.defaultTopK,
        maxTopK: capabilities.maxTopK,
      },
    });
  } catch (error) {
    sendResponse({
      success: false,
      error: error.message,
    });
  }
}

// Update the text processing prompt
async function handleTextProcessing(text, sendResponse) {
  try {
    if (!aiSession) {
      const initialized = await initializeAI();
      if (!initialized) {
        throw new Error(
          "Failed to initialize AI. Check extension permissions.",
        );
      }
    }

    const tokenCount = await aiSession.countPromptTokens(text);
    if (tokenCount > 1024) {
      throw new Error("Text too long. Please select a shorter passage.");
    }

    const stream = await aiSession.promptStreaming(`
            Create a clear, focused summary of the following text. Break it down into:
            1. A brief overview (2-3 sentences)
            2. Key characteristics (3-4 main points)
            3. Important details (2-3 notable facts)

            Format using clear headings and bullet points. Keep it concise and easy to read.
            Avoid including extra metadata or study materials.

            Text to summarize:
            "${text}"
        `);

    let result = "";
    let previousChunk = "";

    for await (const chunk of stream) {
      const newChunk = chunk.startsWith(previousChunk)
        ? chunk.slice(previousChunk.length)
        : chunk;
      result += newChunk;
      previousChunk = chunk;

      try {
        chrome.runtime.sendMessage({
          type: "summaryProgress",
          text: result,
        });
      } catch (e) {
        // Ignore message sending errors if popup is closed
      }
    }

    // Clean up the response
    const cleanedResult = result
      .replace(/\*\*/g, "") // Remove markdown bold
      .replace(/\*\*\*/g, "") // Remove markdown bold-italic
      .replace(/Study Flashcards:.*/s, ""); // Remove flashcard section

    sendResponse({ success: true, summary: cleanedResult });
  } catch (error) {
    console.error("Text processing error:", error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleFlashcardGeneration(summary, sendResponse) {
  try {
    if (!aiSession) {
      const initialized = await initializeAI();
      if (!initialized) {
        throw new Error(
          "Failed to initialize AI. Check extension permissions.",
        );
      }
    }

    const flashcardSession = await aiSession.clone();

    const stream = await flashcardSession.promptStreaming(`
            Create 5 effective study flashcards from this summary:
            "${summary}"

            Format each card exactly as:
            Q: [question]
            A: [answer]
            ---
        `);

    let result = "";
    let previousChunk = "";

    for await (const chunk of stream) {
      const newChunk = chunk.startsWith(previousChunk)
        ? chunk.slice(previousChunk.length)
        : chunk;
      result += newChunk;
      previousChunk = chunk;
    }

    const flashcards = result
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

    flashcardSession.destroy();
    sendResponse({ success: true, flashcards });
  } catch (error) {
    console.error("Flashcard generation error:", error);
    sendResponse({ success: false, error: error.message });
  }
}

function cleanup() {
  if (aiSession) {
    aiSession.destroy();
    aiSession = null;
  }
}

chrome.runtime.onSuspend.addListener(cleanup);
