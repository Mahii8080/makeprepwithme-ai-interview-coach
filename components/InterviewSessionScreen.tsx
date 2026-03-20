
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Subject, ChatMessage, Feedback, Difficulty } from '../types';
import { generateQuestion, evaluateAnswer } from '../services/geminiService';
import { updateProfileOnSessionEnd } from '../services/profileService';
import { Avatar, AvatarState } from './Avatar';
import { MicrophoneIcon } from './icons/MicrophoneIcon';
import { SendIcon } from './icons/SendIcon';
import { StopIcon } from './icons/StopIcon';
import { FeedbackCard } from './FeedbackCard';
import { WebcamMonitor } from './WebcamMonitor';

// SpeechRecognition interfaces for TypeScript
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

interface InterviewSessionScreenProps {
  subject: Subject | string;
  difficulty: Difficulty;
  onEndSession: () => void;
}

const speakingAvatarStates: AvatarState[] = ['speaking', 'speaking_o', 'speaking_e', 'speaking_m'];

const InterviewSessionScreen: React.FC<InterviewSessionScreenProps> = ({ subject, difficulty, onEndSession }) => {
  console.log('🎬 InterviewSessionScreen mounted with:', { subject, difficulty });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [avatarState, setAvatarState] = useState<AvatarState>('idle');
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const sessionScores = useRef<number[]>([]);
  const previousQuestionsRef = useRef<string[]>([]);
  const isInteractionDisabled = isLoading;
  const [showNextQuestionButton, setShowNextQuestionButton] = useState(false);
  const [isUserPresent, setIsUserPresent] = useState(true);
  const absentCountRef = useRef(0);
  const [absentLimitReached, setAbsentLimitReached] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouthShapeIndex = useRef(0);
  const hasInitializedRef = useRef(false);
  const autoStartAttemptsRef = useRef(0);

  const hasModelQuestion = messages.some(m => m.role === 'model');

  const handleEndSessionClick = () => {
    if (sessionScores.current.length > 0) {
      const averageScore = sessionScores.current.reduce((a, b) => a + b, 0) / sessionScores.current.length;
      updateProfileOnSessionEnd(subject as Subject, averageScore);
    }
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    onEndSession();
  };

  const handleUserPresent = () => {
    // Reset absence counter on return
    absentCountRef.current = 0;
    setIsUserPresent(true);
  };

  const handleUserNotPresent = () => {
    // Increment absence counter; if limit reached, end session
    absentCountRef.current += 1;
    setIsUserPresent(false);
    // Optionally show a temporary notice (sets a flag)
    if (absentCountRef.current >= 10) {
      setAbsentLimitReached(true);
      // Small delay to allow user to see message, then end session
      setTimeout(() => {
        handleEndSessionClick();
      }, 1200);
    }
  };

  const speak = useCallback((text: string) => {
    return new Promise<void>((resolve) => {
      const speakText = () => {
        const utterance = new SpeechSynthesisUtterance(text);

        // Optimizing for "Slow and Clear" human-like speech
        utterance.rate = 0.88; // Slightly slower for better articulation
        utterance.pitch = 1.02; // Very slight pitch lift for a friendlier tone
        utterance.volume = 1.0;
        utterance.lang = 'en-US';

        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
          const englishVoices = voices.filter(v => /^en(-|_)?/i.test(v.lang));
          // Prioritizing the most "Premium" sounding system voices
          const preferredNames = [
            'Google US English',
            'Microsoft Aria',
            'Microsoft Jenny',
            'Samantha',
            'Apple Victoria'
          ];

          const preferredVoice =
            englishVoices.find(v => preferredNames.some(name => v.name.includes(name))) ||
            englishVoices.find(v => v.name.includes('Female')) ||
            englishVoices[0];

          if (preferredVoice) {
            utterance.voice = preferredVoice;
          }
        }

        let animationFrame: number;
        let lastToggleTime = 0;

        // Dynamic lip-sync chatter logic
        const animateMouth = (timestamp: number) => {
          if (!lastToggleTime) lastToggleTime = timestamp;

          // Move mouth every 120ms to simulate syllables/phonemes
          if (timestamp - lastToggleTime > 120) {
            const shapes: AvatarState[] = ['speaking', 'speaking_o', 'speaking_e', 'speaking_m'];
            const randomShape = shapes[Math.floor(Math.random() * shapes.length)];
            setAvatarState(randomShape);
            lastToggleTime = timestamp;
          }
          animationFrame = requestAnimationFrame(animateMouth);
        };

        utterance.onstart = () => {
          animationFrame = requestAnimationFrame(animateMouth);
        };

        utterance.onend = () => {
          cancelAnimationFrame(animationFrame);
          setAvatarState('idle');
          resolve();
        };

        utterance.onerror = (error) => {
          console.error('Speech synthesis error:', error);
          cancelAnimationFrame(animationFrame);
          setAvatarState('idle');
          resolve();
        };

        window.speechSynthesis.speak(utterance);
      };

      if (window.speechSynthesis.getVoices().length === 0) {
        window.speechSynthesis.onvoiceschanged = () => {
          window.speechSynthesis.onvoiceschanged = null;
          speakText();
        };
      } else {
        speakText();
      }
    });
  }, []);

  const startNewTurn = useCallback(async () => {
    console.log('🔴 startNewTurn CALLED');
    setShowNextQuestionButton(false);
    setIsLoading(true);
    setAvatarState('thinking');
    try {
      console.log('About to call generateQuestion with:', { subject, difficulty, prevQuestions: previousQuestionsRef.current.length });
      const question = await generateQuestion(subject, difficulty, previousQuestionsRef.current);
      console.log('Question generated:', question);

      if (!question || question.trim().length === 0) {
        console.error('No question returned or question is empty');
        setIsLoading(false);
        setAvatarState('idle');
        return;
      }

      // Track this question to avoid repetition in future calls
      previousQuestionsRef.current.push(question);

      console.log('Setting message with question:', question);
      setMessages(prev => {
        const newMessages: ChatMessage[] = [...prev, { role: 'model', text: question }];
        console.log('Messages updated, total:', newMessages.length);
        return newMessages;
      });

      setIsLoading(false);
      console.log('About to speak question');
      try {
        await speak(question);
      } catch (speakError) {
        console.error('Error speaking:', speakError);
      }
      console.log('Done speaking');
      setAvatarState('listening');
    } catch (error) {
      console.error('Error in startNewTurn:', error);
      setIsLoading(false);
      setAvatarState('idle');
      // Show error message to user
      setMessages(prev => [...prev, { role: 'system', text: 'Oops, something went wrong getting the next question. Give me a second and try again?' }]);
    }
  }, [subject, difficulty, speak]);

  const captureFrame = (): string | null => {
    if (videoRef.current && canvasRef.current && videoRef.current.readyState >= 2) { // Ensure video data is available
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.8); // 80% quality
      }
    }
    return null;
  };

  const handleSubmit = useCallback(async (text: string) => {
    const currentInput = text.trim();
    if (!currentInput || isInteractionDisabled) return;

    setUserInput('');
    setIsLoading(true);
    setAvatarState('thinking');

    const lastQuestion = [...messages].reverse().find(m => m.role === 'model')?.text;
    if (!lastQuestion) {
      console.error("Could not find the last question.");
      setIsLoading(false);
      return;
    }

    const userMessage: ChatMessage = { role: 'user', text: currentInput };
    setMessages(prev => [...prev, userMessage]);

    const imageB64Data = difficulty === 'Advanced' ? captureFrame() : null;
    const feedback: Feedback = await evaluateAnswer(lastQuestion, currentInput, subject as Subject, difficulty, imageB64Data);

    if (!feedback.error) {
      sessionScores.current.push(feedback.score);
    }

    // Set avatar reaction based on score
    if (feedback.error) {
      setAvatarState('confused');
    } else if (feedback.score >= 8) {
      setAvatarState('happy');
    } else if (feedback.score >= 5) {
      setAvatarState('encouraging');
    } else {
      setAvatarState('serious');
    }

    // Brief pause to show the reaction before speaking
    await new Promise(resolve => setTimeout(resolve, 1000));

    const feedbackMessage: ChatMessage = {
      role: 'system',
      text: 'Here is your feedback:',
      feedback: feedback
    };
    setMessages(prev => [...prev, feedbackMessage]);

    await speak(feedback.feedback + (feedback.nonVerbalFeedback ? ` Now, regarding your on-camera presence... ${feedback.nonVerbalFeedback}` : ''));

    setIsLoading(false);
    setAvatarState('idle');
    setShowNextQuestionButton(true);
  }, [isInteractionDisabled, messages, subject, difficulty, speak]);

  useEffect(() => {
    console.log('🔵 useEffect initialization hook running, hasInitializedRef.current:', hasInitializedRef.current);

    if (hasInitializedRef.current) {
      console.log('🔵 Already initialized, skipping');
      return;
    }
    hasInitializedRef.current = true;
    autoStartAttemptsRef.current = 0;

    console.log('🔵 InterviewSessionScreen initializing with:', { subject, difficulty });

    const initialMessage: ChatMessage = {
      role: 'system',
      text: `Alright, let's do this! Starting a ${difficulty} interview on ${subject}. Ready whenever you are.`
    };
    setMessages([initialMessage]);

    return () => {
      console.log('🔵 useEffect cleanup');
      window.speechSynthesis.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (hasModelQuestion || isLoading) return;
    if (autoStartAttemptsRef.current >= 2) return;

    const timer = setTimeout(() => {
      autoStartAttemptsRef.current += 1;
      startNewTurn();
    }, 700);

    return () => clearTimeout(timer);
  }, [hasModelQuestion, isLoading, startNewTurn]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
        setAvatarState('listening');
      };
      recognition.onend = () => {
        setIsListening(false);
        setAvatarState('idle');
      };
      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
        setAvatarState('idle');
      };
      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((result: any) => result[0])
          .map((result) => result.transcript)
          .join('');
        setUserInput(transcript);

        const lastResult = event.results[event.results.length - 1];
        if (lastResult.isFinal) {
          handleSubmit(transcript);
        }
      };
      recognitionRef.current = recognition;
    }
  }, [handleSubmit]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const toggleListen = () => {
    if (isInteractionDisabled || showNextQuestionButton) return;
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      recognitionRef.current?.start();
    }
  };

  if (difficulty === 'Advanced') {
    const lastMessage = messages[messages.length - 1];
    const feedbackToShow = lastMessage?.feedback;

    return (
      <div className="flex flex-col h-screen bg-black relative overflow-hidden">
        {absentLimitReached && (
          <div className="absolute inset-0 bg-black bg-opacity-90 z-40 flex items-center justify-center p-4">
            <div className="bg-gray-800 rounded-lg p-8 shadow-xl max-w-sm w-full text-center border border-gray-700">
              <h2 className="text-xl font-bold text-white mb-2">Session Ended</h2>
              <p className="text-sm text-gray-300 mb-4">You were away from the camera too many times. The session will end now.</p>
              <div className="text-gray-400 text-sm">Redirecting...</div>
            </div>
          </div>
        )}
        {/* Hidden canvas for capturing frames */}
        <canvas ref={canvasRef} className="hidden"></canvas>
        {/* Header */}
        <header className="absolute top-0 left-0 right-0 z-20 flex justify-between items-center p-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">{subject}</h1>
            <span className="text-sm font-semibold px-2 py-1 rounded-md bg-red-600">{difficulty}</span>
          </div>
          <button
            onClick={handleEndSessionClick}
            className="bg-red-600 hover:bg-red-500 text-white font-semibold py-2 px-4 rounded-lg transition-colors z-30">
            End Session
          </button>
        </header>

        {/* Main View: Avatar (left) + Webcam (right) layout for Advanced mode */}
        <div className="flex-1 flex items-stretch justify-center relative px-6">
          {/* Left: Avatar and state */}
          <div className="flex-1 flex items-center justify-center">
            <div className="max-w-lg w-full flex flex-col items-center">
              <Avatar state={avatarState} sizeClassName="w-72 h-72 md:w-[450px] md:h-[450px]" />
              <p className="mt-4 text-gray-300 text-center">
                {avatarState.charAt(0).toUpperCase() + avatarState.slice(1).replace(/_./g, c => ' ' + c[1].toUpperCase())}...
              </p>
            </div>
          </div>

          {/* Right: Webcam feed (larger) */}
          <div className="w-80 md:w-96 p-4 flex items-center justify-center">
            <div className="w-full h-full border-2 border-gray-600 rounded-lg overflow-hidden shadow-2xl bg-black">
              <WebcamMonitor
                ref={videoRef}
                onUserPresent={handleUserPresent}
                onUserNotPresent={handleUserNotPresent}
              />
            </div>
          </div>

          {/* User presence warning (keeps same placement) */}
          {!isUserPresent && (
            <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-10 p-2 mb-2 bg-yellow-600/90 text-white text-center rounded-md font-semibold animate-pulse">
              Please remain visible to the camera.
            </div>
          )}
        </div>

        {/* Chat/Interaction area: render below main view to avoid overlapping avatar */}
        <div className="w-full p-6 bg-gradient-to-t from-black via-black/70 to-transparent flex flex-col items-center z-20">
          {/* Compact question box shown above controls */}
          {(!feedbackToShow && lastMessage?.role === 'model' && lastMessage.text) && (
            <div className="w-full max-w-3xl mb-3 p-3 bg-gray-800/60 border border-gray-700 rounded-lg text-left text-white text-sm">
              <div className="text-xs text-gray-300 font-semibold mb-1">Question</div>
              <div className="truncate" title={lastMessage.text}>{lastMessage.text}</div>
            </div>
          )}

          <div className="text-center text-white text-lg sm:text-xl md:text-2xl font-medium mb-4 h-24 p-2 flex items-center justify-center">
            {isLoading ? <span className="animate-pulse">...</span> :
              isListening ? <span className="text-gray-400 italic">{userInput || "Listening..."}</span> :
                showNextQuestionButton ? 'Review your feedback.' : ' '
            }
          </div>

          {!hasModelQuestion && !isLoading && (
            <button
              onClick={startNewTurn}
              className="mb-4 px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors"
            >
              Generate Question
            </button>
          )}

          {/* Controls */}
          <div className="flex items-center justify-center">
            <button onClick={toggleListen} disabled={isInteractionDisabled || showNextQuestionButton} className={`w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center transition-all transform hover:scale-110 ${isListening ? 'bg-red-500' : 'bg-blue-600 hover:bg-blue-500'} disabled:bg-gray-600 disabled:cursor-not-allowed`}>
              {isListening ? <StopIcon className="w-8 h-8 sm:w-10 sm:h-10 text-white" /> : <MicrophoneIcon className="w-8 h-8 sm:w-10 sm:h-10 text-white" />}
            </button>
          </div>
          <p className="text-gray-500 mt-2 text-sm h-5">
            {showNextQuestionButton ? 'Click "Next Question" to continue' : isListening ? '' : 'Press the button to speak'}
          </p>
        </div>

        {/* Feedback Modal */}
        {feedbackToShow && showNextQuestionButton && (
          <div className="absolute inset-0 bg-black bg-opacity-80 flex items-center justify-center z-30 animate-fade-in-up p-4">
            <div className="max-w-2xl w-full p-0 sm:p-4">
              <FeedbackCard feedback={feedbackToShow} />
              <div className="flex justify-center mt-6">
                <button
                  onClick={startNewTurn}
                  className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-8 rounded-full transition-colors text-lg"
                >
                  Next Question
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen p-4 bg-gray-900 relative">
      <header className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">{subject}</h1>
          <span className={`text-sm font-semibold px-2 py-1 rounded-md ${difficulty === 'Beginner' ? 'bg-green-600' :
            difficulty === 'Intermediate' ? 'bg-yellow-600' : 'bg-red-600'
            }`}>{difficulty}</span>
        </div>
        <button
          onClick={handleEndSessionClick}
          className="bg-red-600 hover:bg-red-500 text-white font-semibold py-2 px-4 rounded-lg transition-colors">
          End Session
        </button>
      </header>
      <div className="flex-1 flex flex-col gap-4 overflow-hidden">
        <div className="flex-1 flex flex-col md:flex-row gap-4 overflow-hidden">
          <div className="w-full md:w-1/3 flex flex-col items-center justify-center bg-gray-800 rounded-lg p-4 space-y-4">
            <Avatar state={avatarState} sizeClassName="w-56 h-56 md:w-80 md:h-80" />
            <p className="mt-4 text-gray-400 text-center animate-pulse h-6">
              {avatarState.charAt(0).toUpperCase() + avatarState.slice(1).replace(/_./g, c => ' ' + c[1].toUpperCase())}...
            </p>
            {/* Hidden canvas is required for advanced mode frame captures, but is not used here */}
            <canvas ref={canvasRef} className="hidden"></canvas>
          </div>
          <div className="flex-1 flex flex-col bg-gray-800 rounded-lg overflow-hidden">
            <div className="flex-1 p-4 space-y-4 overflow-y-auto relative">
              {!hasModelQuestion && !isLoading && (
                <div className="flex justify-center">
                  <button
                    onClick={startNewTurn}
                    className="px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors"
                  >
                    Generate Question
                  </button>
                </div>
              )}
              {messages.map((msg, index) => (
                <div key={index} className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.feedback ? (
                    <div className="w-full">
                      <FeedbackCard feedback={msg.feedback} />
                      {showNextQuestionButton && (
                        <div className="flex justify-center mt-4">
                          <button
                            onClick={startNewTurn}
                            className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-6 rounded-full transition-colors"
                          >
                            Next Question
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className={`max-w-xl p-3 rounded-lg ${msg.role === 'user' ? 'bg-blue-600 text-white' :
                      msg.role === 'model' ? 'bg-gray-700 text-gray-200' : 'bg-transparent text-center w-full text-gray-400 italic'
                      }`}>
                      {msg.text}
                    </div>
                  )}
                </div>
              ))}
              {isLoading && <div className="flex justify-start"><div className="bg-gray-700 text-gray-200 p-3 rounded-lg">...</div></div>}
              <div ref={chatEndRef} />
            </div>
            <div className="p-4 border-t border-gray-700 flex items-center gap-2">
              <button onClick={toggleListen} disabled={isInteractionDisabled || showNextQuestionButton} className={`p-3 rounded-full transition-colors ${isListening ? 'bg-red-500' : 'bg-blue-600 hover:bg-blue-500'} disabled:bg-gray-600 disabled:cursor-not-allowed`}>
                {isListening ? <StopIcon /> : <MicrophoneIcon />}
              </button>
              <input
                type="text"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit(userInput)}
                placeholder={isListening ? 'Listening...' : showNextQuestionButton ? 'Review feedback and click Next.' : 'Type your answer or use the microphone...'}
                className="flex-1 bg-gray-700 border-gray-600 text-white rounded-full py-3 px-5 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed"
                disabled={isInteractionDisabled || showNextQuestionButton}
              />
              <button onClick={() => handleSubmit(userInput)} disabled={!userInput || isInteractionDisabled || showNextQuestionButton} className="p-3 rounded-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed">
                <SendIcon />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InterviewSessionScreen;
