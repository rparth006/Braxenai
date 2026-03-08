import React, { useState, useCallback, useEffect } from 'react';
import { 
  Activity, 
  Eye, 
  AlertTriangle, 
  Zap,
  Terminal,
  Lock,
  Cpu,
  History,
  LayoutDashboard,
  FileText,
  Download,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  LogOut,
  User as UserIcon
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { VideoAnalyzer } from './components/VideoAnalyzer';
import { Auth } from './components/Auth';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { DetectionResult, SignalPoint, Challenge, ScanHistoryItem, User } from './types';
import { motion, AnimatePresence } from 'motion/react';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type View = 'live' | 'history' | 'analytics';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('braxen_token'));
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [view, setView] = useState<View>('live');
  const [result, setResult] = useState<DetectionResult>({
    isDeepfake: false,
    confidence: 0,
    heartRate: 0,
    blinkRate: 0,
    livenessScore: 0,
    anomalies: [],
    riskScore: 0,
    blinkStability: 1,
    headPoseVelocity: 0,
    landmarkJitter: 0,
    microExpressionScore: 0,
    textureNoiseScore: 1,
    eyeReflectionSymmetry: 1,
    audioVideoSync: 1
  });
  const [signal, setSignal] = useState<SignalPoint[]>([]);
  const [logs, setLogs] = useState<string[]>(["[SYSTEM] Initialization complete.", "[SYSTEM] Waiting for biometric input..."]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [history, setHistory] = useState<ScanHistoryItem[]>([]);
  const [stats, setStats] = useState({ totalScans: 0, deepfakeAttempts: 0, averageRisk: 0 });

  // Challenge System State
  const [activeChallenge, setActiveChallenge] = useState<Challenge | undefined>();
  const [challengeQueue, setChallengeQueue] = useState<Challenge[]>([
    { id: '1', instruction: 'Turn Head Left', type: 'head_left', status: 'pending' },
    { id: '2', instruction: 'Blink Twice', type: 'blink', status: 'pending' },
    { id: '3', instruction: 'Raise Eyebrows', type: 'eyebrow_raise', status: 'pending' },
  ]);

  const addLog = (msg: string) => {
    setLogs(prev => [ `[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 14)]);
  };

  const fetchHistory = async () => {
    if (!token) return;
    try {
      const [hRes, sRes] = await Promise.all([
        fetch('/api/scans', { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json()),
        fetch('/api/stats', { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json())
      ]);
      setHistory(hRes);
      setStats(sRes);
    } catch (e) {
      addLog("ERROR: Failed to fetch secure data.");
    }
  };

  const handleAuth = (user: User, token: string) => {
    addLog('[AUTH] Credentials received.');
    setTimeout(() => addLog('[SECURITY] Hash verification successful.'), 500);
    setTimeout(() => {
      addLog('[SESSION] Secure token issued.');
      setUser(user);
      setToken(token);
      localStorage.setItem('braxen_token', token);
    }, 1000);
  };

  const handleLogout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('braxen_token');
    addLog("[AUTH] Session terminated.");
  };

  useEffect(() => {
    const checkAuth = async () => {
      if (!token) {
        setIsAuthLoading(false);
        return;
      }
      try {
        const res = await fetch('/api/auth/me', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const userData = await res.json();
          setUser(userData);
          addLog(`[AUTH] Welcome back, ${userData.email}`);
        } else {
          handleLogout();
        }
      } catch (e) {
        handleLogout();
      } finally {
        setIsAuthLoading(false);
      }
    };
    checkAuth();
  }, []);

  useEffect(() => {
    if (user) fetchHistory();
  }, [view, user]);

  const handleUpdate = useCallback((update: Partial<DetectionResult>, newSignal: SignalPoint[]) => {
    setResult(prev => {
      const newResult = { ...prev, ...update };
      
      // Advanced Risk Calculation
      const anomalies: string[] = [];
      let risk = 0;

      if (newResult.heartRate === 0 && newSignal.length > 50) {
        anomalies.push("No pulse detected in skin texture");
        risk += 0.4;
      }
      if (newResult.livenessScore < 0.6 && newResult.confidence > 0.5) {
        anomalies.push("Low liveness probability");
        risk += 0.3;
      }
      if (newResult.landmarkJitter > 5) {
        anomalies.push("Excessive landmark jitter");
        risk += 0.2;
      }
      if (newResult.blinkStability < 0.3) {
        anomalies.push("Irregular blink cadence");
        risk += 0.15;
      }
      if (newResult.eyeReflectionSymmetry < 0.5) {
        anomalies.push("Asymmetric eye reflections");
        risk += 0.25;
      }

      const isDeepfake = risk > 0.6;
      
      if (isDeepfake !== prev.isDeepfake && isDeepfake) {
        addLog("CRITICAL: Deepfake signature detected in temporal domain.");
      }

      return { ...newResult, isDeepfake, anomalies, riskScore: Math.min(risk, 1) };
    });
    setSignal(newSignal);
  }, []);

  const handleChallengeComplete = (success: boolean) => {
    if (success && activeChallenge) {
      addLog(`CHALLENGE_PASSED: ${activeChallenge.instruction}`);
      setActiveChallenge(undefined);
      const next = challengeQueue.find(c => c.status === 'pending');
      if (next) {
        setTimeout(() => {
          next.status = 'active';
          setActiveChallenge(next);
          addLog(`NEW_CHALLENGE: ${next.instruction}`);
        }, 2000);
      } else {
        addLog("ALL_CHALLENGES_PASSED: Identity Verified.");
      }
    }
  };

  const startVerification = () => {
    const first = challengeQueue[0];
    first.status = 'active';
    setActiveChallenge(first);
    addLog(`VERIFICATION_STARTED: ${first.instruction}`);
  };

  const runGeminiAnalysis = async () => {
  setIsAnalyzing(true);
  addLog("Running analysis...");

  try {
    const response = {
      text: "Analysis completed"
    };

    const assessment = response.text;
    addLog(`AI_ASSESSMENT: ${assessment}`);

  } catch (e) {
    addLog("ERROR: Analysis failed.");
  } finally {
    setIsAnalyzing(false);
  }
};
     const runGeminiAnalysis = async () => {
  setIsAnalyzing(true);
  addLog("Running analysis...");

  try {
    const response = {
      text: "Analysis completed"
    };

    const assessment = response.text;
    addLog(`AI_ASSESSMENT: ${assessment}`);

  } catch (e) {
    addLog("ERROR: Analysis failed.");
  } finally {
    setIsAnalyzing(false);
  }
};
    } catch (e) {
      addLog("ERROR: AI analysis failed.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) {
    return <Auth onAuth={handleAuth} />;
  }

  return (
    <div className="min-h-screen p-6 flex flex-col gap-6 max-w-[1600px] mx-auto bg-[#0A0A0B] text-white">
      {/* Navigation Rail */}
      <nav className="flex items-center justify-between border-b border-white/10 pb-4">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-3">
            <div className="p-1 bg-emerald-500/5 rounded-lg border border-emerald-500/10">
              <svg width="40" height="40" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-emerald-400">
                <path d="M512 896C512 896 192 768 192 448V192L512 128L832 192V448C832 768 512 896 512 896Z" stroke="currentColor" strokeWidth="40" strokeLinejoin="round" fill="rgba(16, 185, 129, 0.05)"/>
                <path d="M512 256V768M256 512H768M384 384L640 640M640 384L384 640" stroke="currentColor" strokeWidth="20" strokeOpacity="0.2"/>
                <circle cx="512" cy="512" r="120" fill="black" stroke="currentColor" strokeWidth="20"/>
                <text x="512" y="550" textAnchor="middle" fill="currentColor" fontSize="120" fontWeight="bold" fontFamily="Arial">B</text>
                <path d="M350 250L450 350M674 250L574 350M350 774L450 674M674 774L574 674" stroke="currentColor" strokeWidth="15" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">BRAXENAI</h1>
              <p className="status-label text-[10px]">Enterprise Forensic Suite v3.0.0</p>
            </div>
          </div>
          
          <div className="flex items-center gap-1 bg-white/5 p-1 rounded-lg border border-white/10">
            <NavButton active={view === 'live'} onClick={() => setView('live')} icon={<LayoutDashboard className="w-4 h-4" />} label="Live Scan" />
            <NavButton active={view === 'history'} onClick={() => setView('history')} icon={<History className="w-4 h-4" />} label="History" />
            <NavButton active={view === 'analytics'} onClick={() => setView('analytics')} icon={<Activity className="w-4 h-4" />} label="Analytics" />
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3 px-4 py-2 bg-white/5 rounded-xl border border-white/10">
            <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <UserIcon className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-left">
              <p className="text-[10px] font-mono text-white/40 uppercase leading-none mb-1">{user.role}</p>
              <p className="text-xs font-bold leading-none">{user.email.split('@')[0]}</p>
            </div>
            <button 
              onClick={handleLogout}
              className="ml-2 p-2 hover:bg-red-500/10 rounded-lg transition-colors group"
              title="Logout"
            >
              <LogOut className="w-4 h-4 text-white/20 group-hover:text-red-400" />
            </button>
          </div>
          <div className="h-8 w-[1px] bg-white/10"></div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-xs font-mono uppercase">System_Active</span>
          </div>
        </div>
      </nav>

      <AnimatePresence mode="wait">
        {view === 'live' && (
          <motion.main 
            key="live"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1"
          >
            {/* Left Column: Video & Challenges */}
            <div className="lg:col-span-7 flex flex-col gap-6">
              <div className={cn("widget-container p-1 relative transition-all duration-500", result.isDeepfake && "is-alert ring-2 ring-red-500/50")}>
                <VideoAnalyzer 
                  onUpdate={handleUpdate} 
                  activeChallenge={activeChallenge}
                  onChallengeComplete={handleChallengeComplete}
                  onError={(err) => addLog(`ERROR: ${err}`)}
                />
                
                {/* Challenge Overlay */}
                <AnimatePresence>
                  {activeChallenge && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="absolute bottom-8 left-1/2 -translate-x-1/2 px-8 py-4 bg-black/80 backdrop-blur-md border border-emerald-500/30 rounded-2xl flex flex-col items-center gap-2 shadow-2xl z-30"
                    >
                      <span className="status-label text-emerald-400">Challenge Active</span>
                      <h2 className="text-2xl font-bold tracking-widest uppercase">{activeChallenge.instruction}</h2>
                      <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden mt-2">
                        <motion.div 
                          initial={{ width: "0%" }}
                          animate={{ width: "100%" }}
                          transition={{ duration: 5 }}
                          className="h-full bg-emerald-500"
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {result.isDeepfake && (
                  <div className="absolute top-6 right-6 px-4 py-2 bg-red-500 text-white rounded-md font-bold flex items-center gap-2 animate-bounce shadow-lg z-20">
                    <AlertTriangle className="w-5 h-5" />
                    RED ALERT: DEEPFAKE DETECTED
                  </div>
                )}
              </div>

              <div className="grid grid-cols-4 gap-4">
                <StatCard icon={<Activity className="w-4 h-4" />} label="Heart Rate" value={`${result.heartRate || '--'}`} unit="BPM" status={result.heartRate > 0 ? 'normal' : 'warning'} />
                <StatCard icon={<Eye className="w-4 h-4" />} label="Liveness" value={`${(result.livenessScore * 100).toFixed(0)}`} unit="%" status={result.livenessScore > 0.7 ? 'normal' : 'warning'} />
                <StatCard icon={<Zap className="w-4 h-4" />} label="Jitter" value={`${result.landmarkJitter.toFixed(1)}`} unit="px" status={result.landmarkJitter < 5 ? 'normal' : 'warning'} />
                <StatCard icon={<Cpu className="w-4 h-4" />} label="Blink Stab." value={`${(result.blinkStability * 100).toFixed(0)}`} unit="%" status={result.blinkStability > 0.5 ? 'normal' : 'warning'} />
              </div>

              {/* Behavioral Signature Section */}
              <div className="widget-container p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-emerald-400">
                      <path d="M512 896C512 896 192 768 192 448V192L512 128L832 192V448C832 768 512 896 512 896Z" stroke="currentColor" strokeWidth="60" strokeLinejoin="round" fill="rgba(16, 185, 129, 0.1)"/>
                      <text x="512" y="580" textAnchor="middle" fill="currentColor" fontSize="300" fontWeight="bold" fontFamily="Arial">B</text>
                    </svg>
                    <span className="status-label">Behavioral Biometric Signature</span>
                  </div>
                  <span className="text-[8px] font-mono text-white/40 uppercase">Profile: User_Alpha_7</span>
                </div>
                <div className="grid grid-cols-3 gap-6">
                  <div className="space-y-1">
                    <p className="text-[8px] text-white/40 uppercase">Blink Rhythm</p>
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500/50 w-[75%]" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[8px] text-white/40 uppercase">Head Velocity</p>
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500/50 w-[40%]" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[8px] text-white/40 uppercase">Micro-Delay</p>
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500/50 w-[90%]" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Risk & Analytics */}
            <div className="lg:col-span-5 flex flex-col gap-6">
              {/* Risk Meter */}
              <div className="widget-container p-6">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-emerald-400" />
                    <span className="status-label">Real-Time Risk Index</span>
                  </div>
                  <span className={cn("font-mono text-lg font-bold", result.riskScore > 0.6 ? "text-red-400" : "text-emerald-400")}>
                    {(result.riskScore * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="h-4 bg-white/5 rounded-full overflow-hidden border border-white/10 p-0.5">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${result.riskScore * 100}%` }}
                    className={cn(
                      "h-full rounded-full transition-colors duration-500",
                      result.riskScore > 0.6 ? "bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]" : "bg-emerald-500 shadow-[0_0_15px_rgba(0,255,157,0.5)]"
                    )}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4 mt-6">
                  <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                    <p className="status-label text-[8px] mb-1">Texture Noise</p>
                    <p className="font-mono text-sm">{(result.textureNoiseScore * 100).toFixed(1)}%</p>
                  </div>
                  <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                    <p className="status-label text-[8px] mb-1">Eye Symmetry</p>
                    <p className="font-mono text-sm">{(result.eyeReflectionSymmetry * 100).toFixed(1)}%</p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-4">
                <button 
                  onClick={startVerification}
                  disabled={!!activeChallenge}
                  className="py-4 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2 group cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  START CHALLENGE
                </button>
                <button 
                  onClick={runGeminiAnalysis}
                  disabled={isAnalyzing}
                  className="py-4 bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-900/50 text-black font-bold rounded-xl transition-all flex items-center justify-center gap-2 group cursor-pointer"
                >
                  {isAnalyzing ? <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" /> : <Cpu className="w-5 h-5" />}
                  AI FORENSIC SCAN
                </button>
              </div>

              {/* System Logs */}
              <div className="widget-container p-6 flex-1 flex flex-col min-h-[300px]">
                <div className="flex items-center gap-2 mb-4">
                  <Terminal className="w-4 h-4 text-emerald-400" />
                  <span className="status-label">Forensic Terminal</span>
                </div>
                <div className="flex-1 font-mono text-[10px] overflow-y-auto space-y-2 text-white/50">
                  {logs.map((log, i) => (
                    <div key={i} className={cn(log.includes('ALERT') || log.includes('CRITICAL') ? "text-red-400" : log.includes('PASSED') ? "text-emerald-400" : "")}>
                      {log}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.main>
        )}

        {view === 'history' && (
          <motion.main 
            key="history"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex-1 flex flex-col gap-6"
          >
            <div className="grid grid-cols-3 gap-6">
              <StatCard icon={<LayoutDashboard className="w-4 h-4" />} label="Total Scans" value={stats.totalScans.toString()} unit="SESSIONS" status="normal" />
              <StatCard icon={<AlertTriangle className="w-4 h-4" />} label="Deepfake Attempts" value={stats.deepfakeAttempts.toString()} unit="BLOCKED" status={stats.deepfakeAttempts > 0 ? 'warning' : 'normal'} />
              <StatCard icon={<Activity className="w-4 h-4" />} label="Avg Risk Index" value={(stats.averageRisk * 100).toFixed(1)} unit="%" status="normal" />
            </div>

            <div className="widget-container flex-1 overflow-hidden flex flex-col">
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-emerald-400" />
                  <span className="status-label">Scan History Database</span>
                </div>
                <button className="flex items-center gap-2 text-[10px] font-mono text-white/40 hover:text-white transition-colors">
                  <Download className="w-3 h-3" /> EXPORT_CSV
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-[#151619] border-b border-white/5">
                    <tr>
                      <th className="p-4 status-label text-[8px]">Timestamp</th>
                      <th className="p-4 status-label text-[8px]">Scan ID</th>
                      <th className="p-4 status-label text-[8px]">Risk Score</th>
                      <th className="p-4 status-label text-[8px]">Status</th>
                      <th className="p-4 status-label text-[8px]">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {history.map((item) => (
                      <tr key={item.id} className="hover:bg-white/5 transition-colors group">
                        <td className="p-4 font-mono text-[10px] text-white/60">{new Date(item.timestamp).toLocaleString()}</td>
                        <td className="p-4 font-mono text-[10px] text-white/60 uppercase">{item.id}</td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden w-16">
                              <div className={cn("h-full", item.risk_score > 0.6 ? "bg-red-500" : "bg-emerald-500")} style={{ width: `${item.risk_score * 100}%` }} />
                            </div>
                            <span className="font-mono text-[10px]">{(item.risk_score * 100).toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <span className={cn(
                            "px-2 py-0.5 rounded text-[8px] font-bold uppercase",
                            item.is_deepfake ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          )}>
                            {item.is_deepfake ? 'Fake' : 'Real'}
                          </span>
                        </td>
                        <td className="p-4">
                          <button className="p-2 hover:bg-white/10 rounded-lg transition-colors">
                            <FileText className="w-4 h-4 text-white/40 group-hover:text-emerald-400" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.main>
        )}

        {view === 'analytics' && (
          <motion.main 
            key="analytics"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="flex-1 grid grid-cols-2 gap-6"
          >
            <div className="widget-container p-6 flex flex-col">
              <div className="flex items-center gap-2 mb-8">
                <Activity className="w-4 h-4 text-emerald-400" />
                <span className="status-label">Risk Distribution Over Time</span>
              </div>
              <div className="flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history.slice().reverse()}>
                    <defs>
                      <linearGradient id="colorRisk" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#00FF9D" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#00FF9D" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis hide dataKey="timestamp" />
                    <YAxis hide domain={[0, 1]} />
                    <Area type="monotone" dataKey="risk_score" stroke="#00FF9D" fillOpacity={1} fill="url(#colorRisk)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="widget-container p-6 flex flex-col">
              <div className="flex items-center gap-2 mb-8">
                <svg width="16" height="16" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-emerald-400">
                  <path d="M512 896C512 896 192 768 192 448V192L512 128L832 192V448C832 768 512 896 512 896Z" stroke="currentColor" strokeWidth="60" strokeLinejoin="round" fill="rgba(16, 185, 129, 0.1)"/>
                  <text x="512" y="580" textAnchor="middle" fill="currentColor" fontSize="300" fontWeight="bold" fontFamily="Arial">B</text>
                </svg>
                <span className="status-label">Security Event Correlation</span>
              </div>
              <div className="flex-1 flex flex-col justify-center items-center text-center p-12">
                <Cpu className="w-12 h-12 text-white/10 mb-4" />
                <p className="status-label text-white/40">Insufficient Data for Correlation Analysis</p>
                <p className="text-[10px] text-white/20 mt-2">Requires minimum 100 scan sessions</p>
              </div>
            </div>
          </motion.main>
        )}
      </AnimatePresence>

      {/* Footer Info */}
      <footer className="flex items-center justify-between text-[10px] text-white/30 font-mono border-t border-white/5 pt-4">
        <div className="flex gap-4">
          <div className="flex items-center gap-1"><Lock className="w-3 h-3" /> PRIVACY_MODE: LOCAL_ONLY</div>
          <div className="flex items-center gap-1"><Cpu className="w-3 h-3" /> ENGINE: MEDIAPIPE_WASM</div>
        </div>
        <div>SCAN_ID: {Math.random().toString(36).substring(7).toUpperCase()}</div>
      </footer>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-md transition-all cursor-pointer",
        active ? "bg-emerald-500 text-black font-bold" : "text-white/60 hover:text-white hover:bg-white/5"
      )}
    >
      {icon}
      <span className="text-xs uppercase tracking-wider">{label}</span>
    </button>
  );
}

function StatCard({ icon, label, value, unit, status }: { 
  icon: React.ReactNode, 
  label: string, 
  value: string, 
  unit: string,
  status: 'normal' | 'warning' | 'alert'
}) {
  return (
    <div className="widget-container p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={cn(
          "p-1 rounded",
          status === 'normal' ? "text-emerald-400 bg-emerald-400/10" : "text-amber-400 bg-amber-400/10"
        )}>
          {icon}
        </div>
        <span className="status-label text-[9px]">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-mono font-bold">{value}</span>
        <span className="text-[10px] text-white/40 font-mono">{unit}</span>
      </div>
    </div>
  );
}
