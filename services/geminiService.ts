
import { GoogleGenAI, Type } from "@google/genai";
import { Subject, Feedback, Difficulty, ResumeData } from '../types';

// Lazily initialize GoogleGenAI client so the app doesn't crash at module import in the browser.
// Support both Node-style `process.env.API_KEY` (server) and Vite client env `import.meta.env.VITE_GEMINI_API_KEY` (local/dev).
const getApiKey = () => {
    try {
        // Prefer Node environment variable when available (e.g., server-side execution)
        if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
            console.log('Using Node API_KEY:', process.env.API_KEY);
            return process.env.API_KEY;
        }
    } catch (e) {
        // ignore
    }

    // Fallback to Vite client env (set in .env.local as VITE_GEMINI_API_KEY). Note: exposing API keys to client is insecure for production.
    // Use this only for local development or when running a secure backend proxy.
    try {
        // import.meta may not be typed here; use any to safely access env
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const meta: any = typeof import.meta !== 'undefined' ? (import.meta as any) : undefined;
        if (meta && meta.env && meta.env.VITE_GEMINI_API_KEY) {
            console.log('Using Vite API_KEY:', meta.env.VITE_GEMINI_API_KEY);
            return meta.env.VITE_GEMINI_API_KEY;
        }
    } catch (e) {
        // ignore
    }

    console.log('No API key found, returning empty string');
    return '';
};

const getApiBaseUrl = (): string => {
    // Prefer explicit API base URL from Vite env (e.g., VITE_API_BASE_URL="https://api.example.com")
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const meta: any = typeof import.meta !== 'undefined' ? (import.meta as any) : undefined;
        const envBase = meta?.env?.VITE_API_BASE_URL;
        if (envBase && typeof envBase === 'string') {
            return envBase.replace(/\/+$/, '');
        }
    } catch (e) {
        // ignore
    }

    // If running locally or on LAN, default to the same host on port 4000.
    try {
        if (typeof window !== 'undefined' && window.location) {
            const { hostname, protocol } = window.location;
            const isLocalhost =
                hostname === 'localhost' ||
                hostname === '127.0.0.1' ||
                hostname === '[::1]' ||
                hostname.endsWith('.local') ||
                /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
            if (isLocalhost) {
                return `${protocol}//${hostname}:4000`;
            }
        }
    } catch (e) {
        // ignore
    }

    // Fallback to relative path (useful in production if API is on same origin)
    return '';
};

const buildApiUrl = (path: string) => {
    const base = getApiBaseUrl();
    if (!base) return path.startsWith('/') ? path : `/${path}`;
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
};

const BACKEND_TIMEOUT_MS = 6000;
const GEMINI_TIMEOUT_MS = 8000;

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`${label} timed out after ${ms}ms`));
        }, ms);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    });
};

const fetchWithTimeout = async (url: string, options: RequestInit, ms: number) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ms);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeoutId);
    }
};

let ai: any | null = null;
const getAi = () => {
    if (!ai) {
        const apiKey = getApiKey();
        if (!apiKey) {
            // Keep initialization lazy; functions will catch and report errors when using the client.
            console.warn('No Gemini API key found in environment. Set API_KEY (server) or VITE_GEMINI_API_KEY (client .env.local).');
        }
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        ai = new GoogleGenAI({ apiKey });
    }
    return ai;
};

const model = 'gemini-2.5-flash';

const questionSchema = {
    type: Type.OBJECT,
    properties: {
        question: {
            type: Type.STRING,
            description: "A single interview question. No multiple parts, no follow-ups, no numbering."
        }
    },
    required: ["question"]
};

const baseFeedbackSchema = {
    type: Type.OBJECT,
    properties: {
        score: {
            type: Type.INTEGER,
            description: "A score from 0 to 10 for the user's answer. 0 is very poor, 10 is excellent."
        },
        feedback: {
            type: Type.STRING,
            description: "Constructive feedback on the user's answer. Highlight good points and areas for improvement. Be encouraging."
        },
        suggestedAnswer: {
            type: Type.STRING,
            description: "An ideal, well-structured answer to the original question."
        }
    },
    required: ["score", "feedback", "suggestedAnswer"]
};

const visualFeedbackSchema = {
    ...baseFeedbackSchema,
    properties: {
        ...baseFeedbackSchema.properties,
        nonVerbalFeedback: {
            type: Type.STRING,
            description: "Feedback on the user's non-verbal communication (e.g., facial expression, confidence, engagement) based on their image. Comment on their professionalism. Be constructive."
        }
    }
};


const getQuestionGenerationPrompt = (subject: Subject | string, difficulty: Difficulty, previousQuestions: string[] = []): string => {
    let persona: string;
    let examContext: string = '';
    let avoidRepetitionContext: string = '';
    let difficultyGuidance: string = '';
    const isHrInterview = /hr/i.test(subject);

    // List of company names to detect company-specific interviews
    const companyNames = [
        'Google', 'Microsoft', 'Amazon', 'Apple', 'Meta', 'Netflix',
        'TCS', 'Infosys', 'Wipro', 'HCL', 'Cognizant', 'IBM', 'Oracle', 'Accenture'
    ];
    const isCompanyInterview = companyNames.some(company => subject.includes(company));

    // Add context about previously asked questions to avoid repetition
    if (previousQuestions.length > 0) {
        avoidRepetitionContext = `\n\nIMPORTANT: Do NOT ask any of these previously asked questions:\n${previousQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n\nPlease ask something completely different and fresh.`;
    }

    // Special handling for companies
    if (isCompanyInterview) {
        examContext = `You're chatting with a candidate for ${subject}. Keep it natural and conversational while asking about topics that ${subject} cares about. `;
    }
    // Special handling for competitive exams
    else if (subject === 'GATE Exam' || subject === 'UPSC Exam') {
        const examType = subject === 'GATE Exam' ? 'GATE (Graduate Aptitude Test in Engineering)' : 'UPSC (Union Public Service Commission)';
        examContext = `Help the candidate prepare for ${examType}. Ask like you're a study buddy or mentor, not a test machine. For GATE: ask about core concepts naturally. For UPSC: chat like you're exploring topics together. `;
    }
    // HR/behavioral interviews
    if (isHrInterview) {
        examContext += `This is a friendly HR chat. Ask a behavioral question that feels natural, like you're getting to know the person. Good examples: "Tell me a bit about yourself", "Any challenges you've tackled?", "What brings you here?", "What are you good at?". Keep it conversational, not interrogating. `;
    }

    switch (difficulty) {
        case 'Beginner':
            persona = isHrInterview
                ? "You're a warm, approachable HR person having a casual chat. Be encouraging and patient. Ask just one question that feels like a normal conversation starter."
                : "You're a friendly interviewer chatting with someone new to the field. Be supportive and ask something that helps you understand the basics of what they know. Keep it light!";
            difficultyGuidance = "The question should be EASY - basic definitions, simple concepts, fundamentals only. No complex scenarios or advanced topics.";
            break;
        case 'Intermediate':
            persona = isHrInterview
                ? "You're an experienced HR professional having a real conversation. Ask one question that digs into their experiences or thinking. Be genuine, not robotic."
                : "You're a knowledgeable interviewer talking with someone who has real experience. Ask something that shows their practical skills and how they solve problems. Sound natural.";
            difficultyGuidance = "The question should be MEDIUM difficulty - practical knowledge, real-world applications, moderate complexity.";
            break;
        case 'Advanced':
            persona = isHrInterview
                ? "You're a seasoned interviewer/manager talking with a senior-level person. Ask a thoughtful question about leadership, judgment calls, or how they think. Be conversational."
                : "You're a senior expert chatting with another seasoned pro. Ask something deep that shows their expertise and how they think about complex problems. Sound like you're having a real conversation.";
            difficultyGuidance = "The question should be HARD - complex scenarios, edge cases, deep understanding, optimization, or design patterns.";
            break;
    }
    // Make the instruction explicit to avoid multi-question outputs
    // Request a strict JSON reply to force a single, machine-parsable question
    return `${persona} ${examContext}We're covering '${subject}'.

${difficultyGuidance}

Ask just ONE question - make it sound natural like you're actually trying to learn about them or explore a topic together. No lists, no multiple parts, no question marks at the end of each part.

Return your question as JSON like this: {"question": "Your question here?"}
Keep it simple and conversational.${avoidRepetitionContext}`;
};


// Fallback questions for demo/testing when API is unavailable
const fallbackQuestions: Record<string, Record<string, string[]>> = {
    'javascript': {
        'Beginner': [
            "Let's start simple. What is a variable in JavaScript, and how do you create one?",
            "How do you write a basic function in JavaScript? Give me an example.",
            "What are the common data types in JavaScript? Name a few.",
            "What's an array in JavaScript and what can you do with it?",
            "Tell me about conditional statements in JavaScript. How do you use if-else?"
        ],
        'Intermediate': [
            "So let's get into something more interesting—the JavaScript event loop. How does it actually work, from your perspective?",
            "What are callbacks and promises? How do they help you handle asynchronous code?",
            "If I asked you to write a debounce function, what would you do? Walk me through your thinking.",
            "Tell me about scope in JavaScript. What's the difference between global and local scope?",
            "How would you find and fix a bug in your JavaScript code? Walk me through your approach."
        ],
        'Advanced': [
            "Let's dig deep—if you had to implement a Promise from scratch, what would you need to handle?",
            "Okay, advanced topic: microtasks vs macrotasks. How would you explain that distinction, and when does it matter?",
            "Hoisting is one of those things that really makes JavaScript unique. Walk me through how it actually works.",
            "I've got a nested array, and I need to flatten it. Tell me how you'd approach that, maybe show me a few ways.",
            "You're looking at a React component that's rendering slowly. What's your process for figuring out what's wrong and fixing it?"
        ]
    },
    'typescript': {
        'Beginner': [
            "So, what is TypeScript? In simple terms, why would you use it?",
            "What is a type in TypeScript? Can you give me a simple example like a string or number?",
            "How do you tell TypeScript that a variable should be a specific type?",
            "What's an interface in TypeScript? How would you create a simple one?",
            "Tell me about the basic types in TypeScript—what are some examples?"
        ],
        'Intermediate': [
            "Let's talk union types. When would you use them and how do you create one?",
            "What are generics in TypeScript and when would you actually use them in real code?",
            "How do you handle cases where a value could be null or undefined in TypeScript?",
            "Tell me about optional properties. How do you make a property optional in an interface?",
            "You've got a function that should accept different types. How would you handle that with TypeScript?"
        ],
        'Advanced': [
            "Let's say you needed to implement a complex type utility. Walk me through how you'd approach that.",
            "Mapped types can be pretty sophisticated. Explain how they work and show me you've really used them.",
            "Template literal types are pretty cool. What can you do with them? Any real use cases you've seen?",
            "Decorators in TypeScript—how do they work? Have you written custom ones?",
            "Here's a deep one: variance in TypeScript generics. Explain that concept."
        ]
    },
    'python': {
        'Beginner': [
            "Let's start simple. What's a variable in Python and how do you create one?",
            "How do you write a function in Python? Give me an example.",
            "What's a list in Python? How do you create one and add items to it?",
            "Tell me about loops in Python. How do you use a for loop?",
            "What are conditional statements in Python? How do you use if, elif, and else?"
        ],
        'Intermediate': [
            "You need to repeat an action on every item in a list. How would you do that in Python?",
            "Tell me about classes and objects in Python. How do you create a simple class?",
            "What's the difference between a list and a dictionary? When would you use each one?",
            "How do you read data from a file in Python? Walk me through the basic steps.",
            "Tell me about error handling in Python. How do you use try and except?"
        ],
        'Advanced': [
            "Metaclasses are pretty advanced. How would you implement one, and what would you use it for?",
            "Descriptors are powerful but confusing to a lot of people. Walk me through how they work.",
            "If you had to optimize a Python script for memory, what's your approach? What tools do you use?",
            "Context managers are elegant. How would you implement one from scratch?",
            "How does Python's import system actually work? Walk me through it."
        ]
    },
    'java': {
        'Beginner': [
            "Let's start with the basics. What is a class in Java and why do you need one?",
            "How do you create a simple variable in Java with a specific type?",
            "Tell me about the main method. What does it do and why is it important?",
            "What's a method in Java and how do you write a simple one?",
            "What are the basic data types in Java? Can you name a few?"
        ],
        'Intermediate': [
            "What's the difference between a class and an object? Give me a real example.",
            "Tell me about constructors in Java. What do they do and how do you write one?",
            "What are access modifiers in Java? Why would you use public, private, or protected?",
            "How do you create a new object from a class in Java?",
            "Tell me about methods. Can you write a method that takes parameters and returns a value?"
        ],
        'Advanced': [
            "Java's memory model is sophisticated. Explain how it works at a deep level.",
            "Streams in Java changed how people write code. What are they, and how do they work?",
            "Design patterns are tools you use. Tell me about some you know and when you'd use them.",
            "If you needed to optimize Java app performance, what's your approach? What tools do you use?",
            "Concurrent collections—what are they? How are they different from regular collections?"
        ]
    },
    'data structures and algorithms': {
        'Beginner': [
            "Let's start with basics. What is an array and how do you create one?",
            "What's a list and how is it different from an array?",
            "Tell me about loops and how you'd go through each item in a list.",
            "What does sorting mean? Can you give me an example of sorted data?",
            "What's the difference between searching for something in a small list versus a big list? Which is faster?"
        ],
        'Intermediate': [
            "What's the difference between a stack and a queue? Give me real-world examples of each.",
            "Tell me about a linked list. How is it different from an array?",
            "Can you explain binary search? How would you use it to find something quickly?",
            "What are some common sorting methods? Name at least two and compare them.",
            "What does Big O notation mean and why does it matter when choosing algorithms?"
        ],
        'Advanced': [
            "Red-black trees are sophisticated. How would you implement one? Tell me the key properties.",
            "Dynamic programming solves hard problems efficiently. Explain it and give me some real examples.",
            "Advanced graph algorithms like Dijkstra's—walk me through how they work.",
            "The trie data structure is useful for specific problems. Explain how it works and where you'd use it.",
            "Longest common subsequence is a classic DP problem. How would you solve it?"
        ]
    },
    'hr interview': {
        'Beginner': [
            "Let's start simple. Tell me your name and a bit about your background.",
            "Why are you interested in this role? What attracted you to apply?",
            "Tell me about something you're good at. What's a strength of yours?",
            "What's something you want to improve about yourself?",
            "Where do you want to be in your career in a few years?"
        ],
        'Intermediate': [
            "Tell me about a time you had to work on a team. How did you contribute?",
            "Can you describe a situation where you had to solve a problem at work? Walk me through it.",
            "Tell me about a time you had to meet a deadline. How did you manage it?",
            "Have you ever disagreed with a coworker? How did you handle it?",
            "What kind of work environment helps you be most productive? Describe it."
        ],
        'Advanced': [
            "What's something you've done that you're really proud of? Walk me through what made it special.",
            "Teams win together. How have you helped your team succeed? Any examples that really stick with you?",
            "Change is constant at work. Tell me about a time you had to adapt to something significant. How did you handle it?",
            "The landscape is always changing—new tech, new approaches. How do you learn and stay current? What's your style?",
            "Nobody's perfect. Tell me about a time you really failed at something. What did you learn from it?"
        ]
    },
    'english speaking practice': {
        'Beginner': [
            "Hey, I'm curious—who are you? Where are you from?",
            "So what does a typical day look like for you? Walk me through it.",
            "What do you like to do in your free time? Any hobbies?",
            "Tell me about your family. Who are they?",
            "What's your favorite food? I'd love to know why you like it."
        ],
        'Intermediate': [
            "You mentioned a trip before—where did you go? What was it like?",
            "Have you faced any big challenges? How did you handle them?",
            "Where do you see yourself heading career-wise? What's the dream?",
            "Is there someone who's really mattered in your life? Who and why?",
            "What's something you've accomplished that you're genuinely proud of?"
        ],
        'Advanced': [
            "We talk a lot about tech these days. What's your take on how technology is changing society? What do you think the big impacts are?",
            "Here's a big one—climate change. What's your perspective? How do you think about it?",
            "Is there a book or movie that really stuck with you? Tell me about it and why it resonated.",
            "Globalization touches everything now. What do you see as the challenges of living in such a connected world?",
            "Learning never stops, does it? What do you think about continuous learning? Why does it matter to you?"
        ]
    },
    'gate exam': {
        'Beginner': [
            "What is the difference between a compiler and an interpreter?",
            "Explain the concept of time complexity with an example.",
            "What is a binary search tree?",
            "Describe the working of a stack data structure.",
            "What is the difference between TCP and UDP?"
        ],
        'Intermediate': [
            "Explain the concept of dynamic programming with an example.",
            "What is the difference between BFS and DFS?",
            "Describe the working of a hash table.",
            "What is normalization in databases?",
            "Explain the concept of virtual memory."
        ],
        'Advanced': [
            "Explain the A* search algorithm.",
            "What is the difference between NP-hard and NP-complete problems?",
            "Describe the working of a B-tree.",
            "Explain the concept of deadlock in operating systems.",
            "What is the CAP theorem in distributed systems?"
        ]
    },
    'upsc exam': {
        'Beginner': [
            "What is the preamble of the Indian Constitution?",
            "Explain the three branches of government in India.",
            "What is the difference between fundamental rights and directive principles?",
            "Describe the federal structure of India.",
            "What is the role of the Election Commission of India?"
        ],
        'Intermediate': [
            "Explain the concept of secularism in the Indian Constitution.",
            "What are the powers of the President of India?",
            "Describe the functions of the Parliament.",
            "What is the significance of the 73rd and 74th Constitutional Amendments?",
            "Explain the concept of judicial review in India."
        ],
        'Advanced': [
            "Discuss the challenges to federalism in India.",
            "Explain the concept of basic structure doctrine.",
            "What are the implications of the Right to Privacy judgment?",
            "Discuss the role of the Supreme Court in protecting fundamental rights.",
            "Explain the concept of cooperative federalism in India."
        ]
    }
};

const getFallbackQuestion = (subject: Subject | string, difficulty: Difficulty, previousQuestions: string[] = []): string => {
    console.log('getFallbackQuestion called with:', { subject, difficulty, previousQuestionsCount: previousQuestions.length });
    const subjectStr = typeof subject === 'string' ? subject.toLowerCase() : String(subject).toLowerCase();
    const difficultyKey = difficulty as 'Beginner' | 'Intermediate' | 'Advanced';
    
    console.log('Looking for fallback questions:', { subject, subjectStr, difficulty: difficultyKey });
    
    let questions = fallbackQuestions[subjectStr]?.[difficultyKey];
    console.log('Direct lookup result:', { questions: questions ? questions.length : 'undefined', subjectStr, difficultyKey });
    
    // If no questions for this subject, try to find a suitable fallback
    if (!questions || questions.length === 0) {
        console.log('No direct questions found, trying fallbacks...');
        // For programming languages, use javascript
        if (['java', 'python', 'typescript', 'c++', 'c#', 'go', 'rust', 'kotlin', 'swift', 'php', 'ruby'].includes(subjectStr)) {
            questions = fallbackQuestions['javascript']?.[difficultyKey];
            console.log('Using javascript fallback:', questions ? questions.length : 'undefined');
        }
        // For DSA related
        else if (subjectStr.includes('data') || subjectStr.includes('algorithm') || subjectStr.includes('dsa')) {
            questions = fallbackQuestions['data structures and algorithms']?.[difficultyKey];
            console.log('Using DSA fallback:', questions ? questions.length : 'undefined');
        }
        // For HR interviews
        else if (subjectStr.includes('hr') || subjectStr.includes('behavioral')) {
            questions = fallbackQuestions['hr interview']?.[difficultyKey];
            console.log('Using HR fallback:', questions ? questions.length : 'undefined');
        }
        // For English/communication
        else if (subjectStr.includes('english') || subjectStr.includes('communication')) {
            questions = fallbackQuestions['english speaking practice']?.[difficultyKey];
            console.log('Using English fallback:', questions ? questions.length : 'undefined');
        }
        // For GATE exam
        else if (subjectStr.includes('gate')) {
            questions = fallbackQuestions['gate exam']?.[difficultyKey];
            console.log('Using GATE fallback:', questions ? questions.length : 'undefined');
        }
        // For UPSC exam
        else if (subjectStr.includes('upsc')) {
            questions = fallbackQuestions['upsc exam']?.[difficultyKey];
            console.log('Using UPSC fallback:', questions ? questions.length : 'undefined');
        }
        // For companies or unknown subjects, use technical questions
        else {
            // Use JavaScript questions for companies, as most tech companies ask coding questions
            questions = fallbackQuestions['javascript']?.[difficultyKey] || fallbackQuestions['hr interview']?.[difficultyKey];
            console.log('Using default fallback:', questions ? questions.length : 'undefined');
        }
    }
    
    if (questions && questions.length > 0) {
        // Get questions that haven't been asked yet
        const unusedQuestions = questions.filter(q => !previousQuestions.includes(q));
        const selectedQuestion = unusedQuestions.length > 0 
            ? unusedQuestions[Math.floor(Math.random() * unusedQuestions.length)]
            : questions[Math.floor(Math.random() * questions.length)];
        
        console.log('Returning fallback question:', selectedQuestion);
        return selectedQuestion;
    }
    
    // Ultimate fallback
    return "So, what's your experience with this? Tell me about what you've worked on.";
};

const generateQuestionViaGemini = async (subject: Subject | string, difficulty: Difficulty, previousQuestions: string[] = []): Promise<string> => {
    console.log('generateQuestionViaGemini called');
    try {
        const prompt = getQuestionGenerationPrompt(subject, difficulty, previousQuestions);
        console.log('Generated prompt for Gemini');
        
        const response = await getAi().models.generateContent({
            model,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: questionSchema,
                temperature: 0.8,
                maxOutputTokens: 120,
                thinkingConfig: { thinkingBudget: 0 }
            }
        });

        const jsonText = (response.text || '').trim();
        console.log('Gemini raw response:', jsonText.substring(0, 200));
        
        const parsed = JSON.parse(jsonText);
        const question = typeof parsed?.question === 'string' ? parsed.question.trim() : '';
        if (!question) {
            throw new Error('Gemini returned an empty question.');
        }
        console.log('✅ generateQuestionViaGemini success:', question);
        return question;
    } catch (error) {
        console.error('❌ generateQuestionViaGemini error:', error);
        throw error;
    }
};

export const generateQuestion = async (subject: Subject | string, difficulty: Difficulty, previousQuestions: string[] = []): Promise<string> => {
    console.log('generateQuestion called with:', { subject, difficulty, previousQuestionsCount: previousQuestions.length });

    const apiKey = getApiKey();
    console.log('API key available:', !!apiKey);

    // Always try backend first (it can use a server-side key even if client has none)
    try {
        console.log('Making API call to backend...');
        const apiBaseUrl = buildApiUrl('/api/generate-question');
        console.log('API URL:', apiBaseUrl);

        const response = await fetchWithTimeout(apiBaseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                subject,
                difficulty,
                previousQuestions,
            }),
        }, BACKEND_TIMEOUT_MS);

        console.log('API response status:', response.status);
        if (!response.ok) {
            const errorText = await response.text();
            console.error('API error response:', errorText);
            throw new Error(`API request failed with status ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        console.log('API response data:', data);
        const question = typeof data?.question === 'string' ? data.question.trim() : '';
        if (question && !question.includes('Mock question')) {
            console.log('✅ Got real question from backend:', question);
            return question;
        }
        console.log('Got mock question, trying direct Gemini...');
    } catch (error) {
        console.error('❌ Error calling backend API:', error);
    }

    // Try direct Gemini only if client API key is present
    if (apiKey) {
        try {
            console.log('Falling back to direct Gemini question generation...');
            const question = await withTimeout(
                generateQuestionViaGemini(subject, difficulty, previousQuestions),
                GEMINI_TIMEOUT_MS,
                'Gemini question generation'
            );
            console.log('✅ Gemini direct question:', question);
            if (question) {
                return question;
            }
        } catch (geminiError) {
            console.error('❌ Error calling Gemini directly:', geminiError);
        }
    } else {
        console.log('No API key available for direct Gemini, using local questions...');
    }

    console.log('Falling back to local questions...');
    // Fallback to local questions if API and Gemini both fail or no key available
    const fallbackQuestion = getFallbackQuestion(subject, difficulty, previousQuestions);
    if (!fallbackQuestion) {
        console.error('❌ No fallback question available! This should not happen.');
        return "Tell me about your experience with this technology.";
    }
    console.log('✅ Returning fallback question:', fallbackQuestion);
    return fallbackQuestion;
};

export const askCustomQuestion = async (question: string, subject: Subject | string, difficulty: Difficulty): Promise<string> => {
    try {
        const response = await getAi().models.generateContent({
            model,
            contents: `You're a friendly interview coach helping someone prepare for ${subject} at the ${difficulty} level. They're asking: "${question}". Give them a helpful, straight answer (keep it under 150 words). Sound like a real person, not a textbook. Be encouraging and practical. Don't ask them follow-up questions.`,
            config: {
                temperature: 0.6,
                maxOutputTokens: 220,
                thinkingConfig: { thinkingBudget: 0 }
            }
        });
        const text = (response.text || '').trim();
        if (!text) {
            return "I couldn't get you an answer just then. Try rephrasing and asking again?";
        }
        return text;
    } catch (error) {
        console.error("Error answering custom question:", error);
        return "Sorry, I hit a snag answering that. Please try again.";
    }
};

const getEvaluationPrompt = (question: string, answer: string, subject: Subject, difficulty: Difficulty, withVisualAnalysis: boolean): string => {
    let evaluationCriteria: string;
    let examContext: string = '';

    // Special handling for competitive exams
    if (subject === 'GATE Exam' || subject === 'UPSC Exam') {
        examContext = `This is ${subject} prep, so think like an expert in that field would. `;
    }

    switch (difficulty) {
        case 'Beginner':
            evaluationCriteria = "Assess their understanding like a supportive mentor. Is the core concept there? That's what matters at this stage. Be encouraging—point out what they got right and gently guide them on what could be better. Your suggested answer should be simple and clear, not overwhelming.";
            break;
        case 'Intermediate':
            evaluationCriteria = "Evaluate like you're checking if they really understand this stuff and can apply it. Is their answer correct? Is it complete? Can they handle real situations? Give them solid feedback that helps them improve. Your suggested answer should be professional and thorough.";
            break;
        case 'Advanced':
            evaluationCriteria = "Think critically like you're talking to another senior person. Do they understand the deep concepts? Are they thinking about edge cases and trade-offs? This should be challenging feedback that pushes them. Your suggested answer should be expert-level and show best practices.";
            break;
    }

    let visualAnalysisInstruction = '';
    if (withVisualAnalysis) {
        visualAnalysisInstruction = "Also, look at their facial expression in the image. Are they confident? Engaged? Professional-looking? Comment naturally on what you see. Include this in the 'nonVerbalFeedback' field.";
    }

    return `
        You're coaching someone preparing for ${subject} at ${difficulty} level.
        ${examContext}${evaluationCriteria}
        ${visualAnalysisInstruction}

        Question they were asked: "${question}"
        Their answer: "${answer}"

        Give them real, human feedback. Be honest but kind. Return JSON with:
        1. 'score': A number from 0-10
        2. 'feedback': What you really think about their answer (honest, encouraging, specific)
        3. 'suggestedAnswer': How an ideal answer to this question might sound
        ${withVisualAnalysis ? "4. 'nonVerbalFeedback': Your thoughts on their presence and confidence (based on their image)" : ""}
    `;
};


export const evaluateAnswer = async (question: string, answer: string, subject: Subject, difficulty: Difficulty, imageB64Data?: string | null): Promise<Feedback> => {
    try {
        const withVisualAnalysis = difficulty === 'Advanced' && !!imageB64Data;
        const schema = withVisualAnalysis ? visualFeedbackSchema : baseFeedbackSchema;
        const prompt = getEvaluationPrompt(question, answer, subject, difficulty, withVisualAnalysis);
        
        let requestContents: string | { parts: any[] };

        if (withVisualAnalysis && imageB64Data) {
            requestContents = {
                parts: [
                    { text: prompt },
                    {
                        inlineData: {
                            mimeType: 'image/jpeg',
                            data: imageB64Data.split(',')[1], // remove dataURL prefix
                        },
                    }
                ]
            };
        } else {
            requestContents = prompt;
        }

        const response = await getAi().models.generateContent({
            model,
            contents: requestContents,
            config: {
                responseMimeType: "application/json",
                responseSchema: schema,
            }
        });
        
        const jsonText = response.text.trim();
        return JSON.parse(jsonText) as Feedback;

    } catch (error) {
        console.error("Error evaluating answer:", error);
        return {
            score: 0,
            feedback: "Oops, something went wrong while I was evaluating your answer. It might be a network hiccup or a content issue. Want to give it another shot or try a different answer?",
            suggestedAnswer: "No suggestion available right now.",
            error: true
        };
    }
};

// Resume-based interview functions
const resumeParsingSchema = {
    type: Type.OBJECT,
    properties: {
        skills: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "List of technical and professional skills found in the resume"
        },
        projects: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "List of projects and their descriptions found in the resume"
        },
        experience: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "List of work experience and roles mentioned in the resume"
        },
        education: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "List of educational qualifications mentioned in the resume"
        }
    },
    required: ["skills", "projects", "experience", "education"]
};

export const parseResumeText = async (resumeText: string): Promise<ResumeData> => {
    try {
        const response = await getAi().models.generateContent({
            model,
            contents: [
                {
                    role: "user",
                    parts: [
                        {
                            text: `Please analyze this resume and extract the following information in JSON format:
- skills: Array of technical and professional skills
- projects: Array of projects with brief descriptions
- experience: Array of work experience/job roles
- education: Array of educational qualifications

Resume content:
${resumeText}

Return ONLY valid JSON with the exact structure specified.`
                        }
                    ]
                }
            ],
            config: {
                responseMimeType: "application/json",
                responseSchema: resumeParsingSchema,
            }
        });

        const jsonText = response.text.trim();
        return JSON.parse(jsonText) as ResumeData;
    } catch (error) {
        console.error("Error parsing resume:", error);
        return {
            skills: [],
            projects: [],
            experience: [],
            education: []
        };
    }
};

export const generateResumeBasedQuestion = async (resumeData: ResumeData, questionIndex: number): Promise<string> => {
    try {
        // Rotate through different question types based on index
        const questionTypes = [
            `Based on the skills mentioned (${resumeData.skills.slice(0, 3).join(', ')}), ask a technical question related to one of these skills.`,
            `Based on the projects mentioned, ask a question about the most relevant project and how it demonstrates problem-solving.`,
            `Ask a behavioral question related to the experience mentioned (${resumeData.experience[0] || 'work experience'}).`,
            `Ask a question about how one of the skills (${resumeData.skills[Math.floor(Math.random() * resumeData.skills.length)] || 'mentioned skills'}) has been applied in practice.`
        ];

        const selectedType = questionTypes[questionIndex % questionTypes.length];

        const response = await getAi().models.generateContent({
            model,
            contents: [
                {
                    role: "user",
                    parts: [
                        {
                            text: `You are conducting a technical interview based on someone's resume. ${selectedType}

Resume Summary:
Skills: ${resumeData.skills.join(', ')}
Projects: ${resumeData.projects.slice(0, 2).join('; ')}
Experience: ${resumeData.experience.slice(0, 2).join('; ')}

Generate EXACTLY ONE clear, professional interview question. The question should be specific to their resume and assess their technical knowledge or problem-solving approach.

Return ONLY the question in this JSON format: {"question": "Your question here?"}`
                        }
                    ]
                }
            ],
            config: {
                responseMimeType: "application/json",
                responseSchema: questionSchema,
            }
        });

        const jsonText = response.text.trim();
        const parsed = JSON.parse(jsonText);
        return parsed.question || "Tell me about your experience with the technologies mentioned in your resume.";
    } catch (error) {
        console.error("Error generating resume-based question:", error);
        return `Tell me about your experience with ${resumeData.skills[0] || 'the skills mentioned in your resume'}?`;
    }
};

export const provideFeedbackOnAnswer = async (question: string, answer: string, resumeData: ResumeData): Promise<Feedback> => {
    try {
        const response = await getAi().models.generateContent({
            model,
            contents: [
                {
                    role: "user",
                    parts: [
                        {
                            text: `You are evaluating a resume-based interview answer. 

Question asked: "${question}"

Candidate's answer: "${answer}"

Candidate's skills from resume: ${resumeData.skills.join(', ')}

Please evaluate the answer based on:
1. Technical accuracy and relevance to their stated skills
2. Clarity and communication
3. Depth of understanding
4. How well it aligns with their resume

Provide constructive feedback and a score from 0-10.`
                        }
                    ]
                }
            ],
            config: {
                responseMimeType: "application/json",
                responseSchema: baseFeedbackSchema,
            }
        });

        const jsonText = response.text.trim();
        return JSON.parse(jsonText) as Feedback;
    } catch (error) {
        console.error("Error providing feedback on answer:", error);
        return {
            score: 7,
            feedback: "Good effort! Try to provide more specific examples from your experience.",
            suggestedAnswer: "A strong answer would include specific technical details and concrete examples from your projects.",
            error: true
        };
    }
};

// Test function for debugging - can be called from browser console
(globalThis as any).testQuestion = async (subject = 'JavaScript', difficulty = 'Beginner') => {
    console.log('Testing generateQuestion with:', { subject, difficulty });
    try {
        const q = await generateQuestion(subject as any, difficulty as any, []);
        console.log('✅ Generated question:', q);
        return q;
    } catch (err) {
        console.error('❌ Error:', err);
        return null;
    }
};
