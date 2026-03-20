
import React, { useState, useCallback, useEffect } from 'react';
import LoginScreen from './components/LoginScreen';
import DashboardScreen from './components/DashboardScreen';
import InterviewSessionScreen from './components/InterviewSessionScreen';
import ProfileScreen from './components/ProfileScreen';
import ResumeScreen from './components/ResumeScreen';
import { Subject, View, Difficulty } from './types';
import { isLoggedIn } from './services/authService';

const App: React.FC = () => {
  const [view, setView] = useState<View>('login');
  const [currentSubject, setCurrentSubject] = useState<Subject | string | null>(null);
  const [currentDifficulty, setCurrentDifficulty] = useState<Difficulty | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(isLoggedIn());

  useEffect(() => {
    // Check if user is logged in on app load
    // Temporarily bypass login for testing
    setIsAuthenticated(true);
    setView('dashboard');
    // if (isLoggedIn()) {
    //   setIsAuthenticated(true);
    //   setView('dashboard');
    // }
  }, []);

  const handleStartInterview = useCallback((subject: Subject | string, difficulty: Difficulty) => {
    setCurrentSubject(subject);
    setCurrentDifficulty(difficulty);
    setView('session');
  }, []);

  const handleEndInterview = useCallback(() => {
    setView('dashboard');
    setCurrentSubject(null);
    setCurrentDifficulty(null);
  }, []);

  const handleLogout = useCallback(() => {
    setIsAuthenticated(false);
    setView('login');
  }, []);

  const renderView = () => {
    switch (view) {
      case 'login':
        return (
          <LoginScreen
            onGetStarted={() => {
              setIsAuthenticated(true);
              setView('dashboard');
            }}
          />
        );
      case 'dashboard':
        return <DashboardScreen onStartInterview={handleStartInterview} onViewProfile={() => setView('profile')} onResumeInterview={() => setView('resume')} />;
      case 'profile':
        return <ProfileScreen onBack={() => setView('dashboard')} onLogout={handleLogout} />;
      case 'resume':
        return <ResumeScreen onBack={() => setView('dashboard')} />;
      case 'session':
        if (currentSubject && currentDifficulty) {
          return <InterviewSessionScreen subject={currentSubject} difficulty={currentDifficulty} onEndSession={handleEndInterview} />;
        }
        return <DashboardScreen onStartInterview={handleStartInterview} onViewProfile={() => setView('profile')} onResumeInterview={() => setView('resume')} />;
      default:
        return <LoginScreen onGetStarted={() => setView('dashboard')} />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans">
      {renderView()}
    </div>
  );
};

export default App;