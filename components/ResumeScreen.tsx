import React, { useState, useRef, useEffect } from 'react';
import { ResumeData, Feedback } from '../types';
import { parseResumeText, generateResumeBasedQuestion, provideFeedbackOnAnswer } from '../services/geminiService';
import { Avatar, AvatarState } from './Avatar';
import { MicrophoneIcon } from './icons/MicrophoneIcon';
import { StopIcon } from './icons/StopIcon';
import { SendIcon } from './icons/SendIcon';

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

interface ResumeScreenProps {
  onBack: () => void;
}

const ResumeScreen: React.FC<ResumeScreenProps> = ({ onBack }) => {
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeText, setResumeText] = useState('');
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Interview session state
  const [inSession, setInSession] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [userAnswer, setUserAnswer] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [sessionAnswers, setSessionAnswers] = useState<Array<{ question: string; answer: string; feedback: Feedback }>>([]);

  const [avatarState, setAvatarState] = useState<AvatarState>('idle');
  const [isSpeaking, setIsSpeaking] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const synthesisRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Helper for speech synthesis with lip sync
  const speak = (text: string) => {
    if (!window.speechSynthesis) return;

    // Stop any current speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    synthesisRef.current = utterance;

    utterance.onstart = () => {
      setAvatarState('speaking');
      setIsSpeaking(true);
    };

    utterance.onend = () => {
      setAvatarState('idle');
      setIsSpeaking(false);
    };

    // Lip sync effect (randomly switch between mouth shapes)
    const mouthInterval = setInterval(() => {
      if (window.speechSynthesis.speaking) {
        const mouthShapes: AvatarState[] = ['speaking_o', 'speaking_e', 'speaking_m'];
        setAvatarState(mouthShapes[Math.floor(Math.random() * mouthShapes.length)]);
      } else {
        clearInterval(mouthInterval);
      }
    }, 150);

    window.speechSynthesis.speak(utterance);
  };

  // Initialize speech recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;

      recognitionRef.current.onstart = () => setIsListening(true);
      recognitionRef.current.onend = () => setIsListening(false);
      recognitionRef.current.onresult = (event: any) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            setUserAnswer(prev => prev + transcript + ' ');
          } else {
            interimTranscript += transcript;
          }
        }
      };
    }
  }, []);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setResumeFile(file);
    setError('');

    // Read file content
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        setResumeText(text);

        // Parse resume
        setLoading(true);
        const parsed = await parseResumeText(text);
        setResumeData(parsed);
        setLoading(false);
      } catch (err) {
        setError('Failed to parse resume. Please try again.');
        setLoading(false);
      }
    };
    reader.readAsText(file);
  };

  const startInterview = async () => {
    if (!resumeData) return;

    try {
      setLoading(true);
      // Generate first question
      const question = await generateResumeBasedQuestion(resumeData, 0);
      setCurrentQuestion(question);
      setInSession(true);
      setUserAnswer('');
      setFeedback(null);
      setQuestionIndex(0);
      setLoading(false);
      speak(question);
    } catch (err) {
      setError('Failed to generate question. Please try again.');
      setLoading(false);
    }
  };

  const startListening = () => {
    if (recognitionRef.current && !isListening) {
      recognitionRef.current.start();
    }
  };

  const stopListening = () => {
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop();
    }
  };

  const handleSubmitAnswer = async () => {
    if (!userAnswer.trim() || !resumeData) return;

    try {
      setLoading(true);
      const answerFeedback = await provideFeedbackOnAnswer(
        currentQuestion,
        userAnswer,
        resumeData
      );
      setFeedback(answerFeedback);

      // Provide immediate verbal feedback
      if (answerFeedback.score >= 8) {
        setAvatarState('happy');
        speak(`Great answer! ${answerFeedback.feedback}`);
      } else if (answerFeedback.score >= 5) {
        setAvatarState('encouraging');
        speak(`Good points. ${answerFeedback.feedback}`);
      } else {
        setAvatarState('serious');
        speak(`I see. ${answerFeedback.feedback}`);
      }

      setSessionAnswers([
        ...sessionAnswers,
        {
          question: currentQuestion,
          answer: userAnswer,
          feedback: answerFeedback
        }
      ]);
      setLoading(false);
    } catch (err) {
      setError('Failed to get feedback. Please try again.');
      setLoading(false);
    }
  };

  const handleNextQuestion = async () => {
    try {
      setLoading(true);
      const nextIndex = questionIndex + 1;
      const newQuestion = await generateResumeBasedQuestion(resumeData!, nextIndex);
      setCurrentQuestion(newQuestion);
      setQuestionIndex(nextIndex);
      setUserAnswer('');
      setFeedback(null);
      setLoading(false);
      speak(newQuestion);
    } catch (err) {
      setError('Failed to generate next question.');
      setLoading(false);
    }
  };

  const endSession = () => {
    setInSession(false);
    setResumeData(null);
    setResumeFile(null);
    setResumeText('');
    setCurrentQuestion('');
    setUserAnswer('');
    setFeedback(null);
    setQuestionIndex(0);
    setSessionAnswers([]);
    setError('');
  };

  if (!inSession && !resumeData) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 p-6">
        <div className="max-w-2xl mx-auto">
          <button
            onClick={onBack}
            className="mb-6 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition"
          >
            ← Back
          </button>

          <div className="bg-gray-800 rounded-xl p-8 shadow-2xl">
            <h1 className="text-4xl font-bold mb-4 text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
              📄 Resume-Based Interview
            </h1>
            <p className="text-gray-300 mb-8 text-lg">
              Upload your resume and let AI ask you interview questions based on your skills, projects, and experience.
            </p>

            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-blue-400 rounded-lg p-8 text-center cursor-pointer hover:border-blue-300 hover:bg-gray-700/50 transition"
            >
              <div className="text-5xl mb-4">📁</div>
              <p className="text-xl font-semibold mb-2">Upload Your Resume</p>
              <p className="text-gray-400">Click to select a text file or PDF</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.pdf,.doc,.docx"
                onChange={handleFileSelect}
                hidden
              />
            </div>

            {resumeFile && (
              <div className="mt-6 p-4 bg-green-900/30 border border-green-500 rounded-lg">
                <p className="text-green-400">✓ Resume loaded: {resumeFile.name}</p>
              </div>
            )}

            {error && (
              <div className="mt-6 p-4 bg-red-900/30 border border-red-500 rounded-lg">
                <p className="text-red-400">✗ {error}</p>
              </div>
            )}

            {loading && (
              <div className="mt-6 p-4 bg-blue-900/30 border border-blue-500 rounded-lg">
                <p className="text-blue-400">⏳ Processing...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!inSession && resumeData) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 p-6">
        <div className="max-w-3xl mx-auto">
          <button
            onClick={() => {
              setResumeData(null);
              setResumeFile(null);
            }}
            className="mb-6 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition"
          >
            ← Back
          </button>

          <div className="bg-gray-800 rounded-xl p-8 shadow-2xl">
            <h2 className="text-3xl font-bold mb-6 text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
              Resume Analysis
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              {resumeData.skills.length > 0 && (
                <div className="bg-gray-700 rounded-lg p-5">
                  <h3 className="text-xl font-bold mb-4 text-blue-400">💡 Skills Found</h3>
                  <div className="flex flex-wrap gap-2">
                    {resumeData.skills.slice(0, 8).map((skill, idx) => (
                      <span
                        key={idx}
                        className="bg-blue-500/30 text-blue-300 px-3 py-1 rounded-full text-sm"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {resumeData.projects.length > 0 && (
                <div className="bg-gray-700 rounded-lg p-5">
                  <h3 className="text-xl font-bold mb-4 text-purple-400">🚀 Projects Found</h3>
                  <ul className="space-y-2">
                    {resumeData.projects.slice(0, 3).map((project, idx) => (
                      <li key={idx} className="text-gray-300 text-sm">
                        • {project}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* AI Suggestions Section */}
            {resumeData.suggestions && (
              <div className="mb-8 p-6 bg-blue-900/20 border border-blue-500/30 rounded-xl">
                <h3 className="text-2xl font-bold mb-4 text-transparent bg-clip-text bg-gradient-to-r from-blue-300 to-purple-400">
                  ✨ Interviewer's Recommendations
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                  <div>
                    <h4 className="text-sm font-bold text-green-400 mb-2 uppercase tracking-wider">Add These Skills</h4>
                    <div className="flex flex-wrap gap-2">
                      {resumeData.suggestions.toAdd.map((s, i) => (
                        <span key={i} className="text-xs bg-green-500/20 text-green-300 px-2 py-1 rounded">+{s}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-red-400 mb-2 uppercase tracking-wider">Remove/Update</h4>
                    <div className="flex flex-wrap gap-2">
                      {resumeData.suggestions.toRemove.map((s, i) => (
                        <span key={i} className="text-xs bg-red-500/20 text-red-300 px-2 py-1 rounded">-{s}</span>
                      ))}
                    </div>
                  </div>
                </div>

                <p className="text-gray-400 text-sm italic border-t border-gray-700 pt-3">
                  <span className="font-bold text-gray-300">Why?</span> {resumeData.suggestions.justification}
                </p>
              </div>
            )}

            <button
              onClick={startInterview}
              disabled={loading}
              className="w-full py-4 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 rounded-lg font-bold text-lg transition"
            >
              {loading ? '⏳ Preparing...' : '🎤 Start Resume Interview'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
            Resume-Based Interview
          </h2>
          <button
            onClick={endSession}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition"
          >
            End Session
          </button>
        </div>

        {/* Question Section */}
        <div className="flex flex-col md:flex-row gap-6 mb-6">
          {/* Avatar Side */}
          <div className="md:w-1/3 flex flex-col items-center justify-center bg-gray-800 rounded-xl p-6 shadow-xl border border-gray-700">
            <Avatar state={avatarState} sizeClassName="w-48 h-48" />
            <div className="mt-4 px-4 py-2 bg-gray-700 rounded-full text-xs font-bold text-blue-300 animate-pulse">
              {avatarState.toUpperCase().replace('_', ' ')}
            </div>
          </div>

          {/* Question / Text Side */}
          <div className="md:w-2/3 bg-gray-800 rounded-xl p-8 shadow-2xl flex flex-col justify-center">
            <div className="mb-4">
              <span className="text-sm text-gray-400">Question {questionIndex + 1}</span>
            </div>
            <h3 className="text-2xl font-bold text-white leading-tight">{currentQuestion}</h3>
          </div>
        </div>

        {/* Answer Input Section */}
        <div className="bg-gray-800 rounded-xl p-8 shadow-2xl mb-6 border border-gray-700">

          {/* Answer Input */}
          <textarea
            value={userAnswer}
            onChange={(e) => setUserAnswer(e.target.value)}
            placeholder="Type your answer or use the microphone button below..."
            className="w-full bg-gray-700 text-white rounded-lg p-4 mb-4 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={6}
          />

          {/* Controls */}
          <div className="flex gap-4 mb-6">
            {isListening ? (
              <button
                onClick={stopListening}
                className="flex items-center gap-2 px-6 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition"
              >
                <StopIcon className="h-5 w-5" />
                Stop Listening
              </button>
            ) : (
              <button
                onClick={startListening}
                className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition"
              >
                <MicrophoneIcon className="h-5 w-5" />
                Start Listening
              </button>
            )}

            <button
              onClick={handleSubmitAnswer}
              disabled={!userAnswer.trim() || loading}
              className="flex items-center gap-2 px-6 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg transition"
            >
              <SendIcon className="h-5 w-5" />
              Submit Answer
            </button>
          </div>

          {error && (
            <div className="p-4 bg-red-900/30 border border-red-500 rounded-lg">
              <p className="text-red-400">{error}</p>
            </div>
          )}

          {loading && (
            <div className="p-4 bg-blue-900/30 border border-blue-500 rounded-lg">
              <p className="text-blue-400">⏳ Processing your answer...</p>
            </div>
          )}
        </div>

        {/* Feedback Section */}
        {feedback && (
          <div className="bg-gray-800 rounded-xl p-8 shadow-2xl">
            <h4 className="text-xl font-bold mb-4 text-green-400">✓ Feedback</h4>

            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm text-gray-400">Your Score:</span>
                <span className="text-3xl font-bold text-yellow-400">{feedback.score}/10</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-green-500 to-blue-500 h-2 rounded-full transition-all"
                  style={{ width: `${(feedback.score / 10) * 100}%` }}
                />
              </div>
            </div>

            <div className="mb-6">
              <h5 className="font-semibold text-white mb-2">Feedback</h5>
              <p className="text-gray-300">{feedback.feedback}</p>
            </div>

            {feedback.nonVerbalFeedback && (
              <div className="mb-6 p-4 bg-blue-900/20 border border-blue-500 rounded-lg">
                <h5 className="font-semibold text-blue-300 mb-2">Non-Verbal Feedback</h5>
                <p className="text-gray-300">{feedback.nonVerbalFeedback}</p>
              </div>
            )}

            <div className="mb-6">
              <h5 className="font-semibold text-white mb-2">Suggested Answer</h5>
              <p className="text-gray-300 italic">{feedback.suggestedAnswer}</p>
            </div>

            <button
              onClick={handleNextQuestion}
              disabled={loading}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg font-bold transition"
            >
              {loading ? '⏳ Generating...' : '→ Next Question'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ResumeScreen;
