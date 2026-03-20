import React from 'react';

export type AvatarState = 'idle' | 'speaking' | 'listening' | 'thinking' | 'happy' | 'serious' | 'confused' | 'encouraging' | 'speaking_o' | 'speaking_e' | 'speaking_m';

interface AvatarProps {
    state: AvatarState;
    sizeClassName?: string;
}

const FaceFeatures: React.FC<{ state: AvatarState }> = ({ state }) => {
    const irisColor = "#4299e1"; // More vibrant blue

    // Realistic Eyebrows
    let leftEyebrow = <path d="M 12 11 C 14 9, 17 9, 19 11" stroke="#2d3748" strokeWidth="1.5" fill="none" strokeLinecap="round" className="transition-all duration-300" />;
    let rightEyebrow = <path d="M 23 11 C 25 9, 28 9, 30 11" stroke="#2d3748" strokeWidth="1.5" fill="none" strokeLinecap="round" className="transition-all duration-300" />;

    // Eyes with Lids and Shine
    const isSquinting = state === 'happy' || state === 'encouraging';

    const eyeBase = (cx: number, cy: number, isRight: boolean) => (
        <g className={isSquinting ? "" : "animate-blink"} style={{ transformOrigin: `${cx}px ${cy}px` }}>
            {/* Sclera */}
            <path d={`M ${cx - 4} ${cy} C ${cx - 4} ${cy - 3}, ${cx + 4} ${cy - 3}, ${cx + 4} ${cy} C ${cx + 4} ${cy + 3}, ${cx - 4} ${cy + 3}, ${cx - 4} ${cy} Z`} fill="white" />

            {/* Pupil/Iris */}
            <g className="animate-blink-pupil">
                <circle cx={cx} cy={cy} r="2.8" fill={irisColor} />
                <circle cx={cx} cy={cy} r="1.5" fill="#1a202c" />
                {/* Eye Shine */}
                <circle cx={cx - 0.8} cy={cy - 0.8} r="0.6" fill="white" fillOpacity="0.8" />
            </g>
        </g>
    );

    let leftEye = isSquinting ? (
        <path d="M9 19 C12 17, 15 17, 17 19" stroke="#4a5568" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    ) : eyeBase(14, 18, false);

    let rightEye = isSquinting ? (
        <path d="M23 19 C26 17, 29 17, 31 19" stroke="#4a5568" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    ) : eyeBase(27, 18, true);

    const mouthPaths = {
        idle: "M17 29 Q 20 30 23 29",
        listening: "M17 29 Q 20 31 23 29",
        thinking: "M18 29.5 H 22",
        speaking: "M16 30 Q 20 36 24 30",
        speaking_o: "M18 29 A 2 3 0 1 0 22 29 A 2 3 0 1 0 18 29",
        speaking_e: "M16 29.5 Q 20 29, 24 29.5 M 17 30 H 23",
        speaking_m: "M17 30 H 23",
        happy: "M15 29 Q 20 35 25 29",
        serious: "M17 30 H 23",
        confused: "M18 30 C 19 28, 21 28, 22 30",
        encouraging: "M16 29 Q 20 33 24 29"
    };

    let mouthPath = mouthPaths.idle;

    switch (state) {
        case 'speaking': mouthPath = mouthPaths.speaking; break;
        case 'speaking_o': mouthPath = mouthPaths.speaking_o; break;
        case 'speaking_e': mouthPath = mouthPaths.speaking_e; break;
        case 'speaking_m': mouthPath = mouthPaths.speaking_m; break;
        case 'thinking': mouthPath = mouthPaths.thinking; break;
        case 'happy':
        case 'encouraging':
            mouthPath = state === 'happy' ? mouthPaths.happy : mouthPaths.encouraging;
            break;
        case 'serious': mouthPath = mouthPaths.serious; break;
        case 'confused': mouthPath = mouthPaths.confused; break;
        default: mouthPath = mouthPaths.idle;
    }

    return (
        <g>
            {/* Eyebrows */}
            {leftEyebrow}
            {rightEyebrow}

            {/* Eyes */}
            {leftEye}
            {rightEye}

            {/* Nose - More defined structure */}
            <path d="M20 22 L 20 24 M 19 26 Q 20 27 21 26" stroke="#a0aec0" strokeWidth="1" fill="none" strokeLinecap="round" />

            {/* Mouth */}
            <path
                d={mouthPath}
                stroke="#2d3748"
                strokeWidth="1.8"
                fill={state.startsWith('speaking') && state !== 'speaking_m' ? "rgba(0,0,0,0.15)" : "none"}
                strokeLinecap="round"
                className="transition-all duration-100 ease-in-out"
            />
        </g>
    );
};


export const Avatar: React.FC<AvatarProps> = ({ state, sizeClassName = "w-48 h-48" }) => {
    const isSpeaking = state.startsWith('speaking');
    const isInteracting = state === 'thinking' || state === 'listening' || isSpeaking;

    return (
        <div className={`${sizeClassName} rounded-3xl bg-slate-900 flex items-center justify-center shadow-2xl overflow-hidden border border-slate-700 relative group`}>
            {/* Dynamic Background Glow when speaking */}
            <div className={`absolute inset-0 bg-blue-500/10 transition-opacity duration-1000 ${isSpeaking ? 'opacity-100 animate-pulse' : 'opacity-0'}`} />
            <div className="absolute inset-0 bg-gradient-to-br from-blue-900/20 to-purple-900/20 opacity-50" />

            <svg viewBox="0 0 100 100" className="w-full h-full relative z-10 drop-shadow-xl">
                <defs>
                    <radialGradient id="faceGradient" cx="50%" cy="40%" r="60%">
                        <stop offset="0%" stopColor="#ffffff" />
                        <stop offset="40%" stopColor="#f7fafc" />
                        <stop offset="100%" stopColor="#e2e8f0" />
                    </radialGradient>

                    <linearGradient id="hairGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#4a5568" />
                        <stop offset="100%" stopColor="#1a202c" />
                    </linearGradient>

                    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur in="SourceAlpha" stdDeviation="1.5" />
                        <feOffset dx="0" dy="1.5" result="offsetblur" />
                        <feComponentTransfer>
                            <feFuncA type="linear" slope="0.3" />
                        </feComponentTransfer>
                        <feMerge>
                            <feMergeNode />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>

                {/* Whole Character Container - Breathing Sync */}
                <g className="animate-breath" style={{ transformOrigin: 'center bottom' }}>

                    {/* Body / Suit */}
                    <path d="M10 100 Q 10 75, 35 72 C 45 71, 55 71, 65 72 Q 90 75, 90 100 Z" fill="#2d3748" filter="url(#shadow)" />

                    {/* Shirt and Silk Tie */}
                    <path d="M38 72 L 50 88 L 62 72 Z" fill="white" />
                    <path d="M48 72 L 50 92 L 52 72 Z" fill="#c53030" />

                    {/* Lapels */}
                    <path d="M35 72 L 50 88 L 42 72 Z" fill="#1a202c" />
                    <path d="M65 72 L 50 88 L 58 72 Z" fill="#1a202c" />

                    {/* Head & Neck Combined Group - Tilting Sync */}
                    <g className={isInteracting ? 'animate-head-tilt' : ''} style={{ transformOrigin: '50px 75px' }}>
                        {/* Neck - Properly Connected to Suit and Head */}
                        <path d="M43 55 Q 50 58 57 55 L 60 78 L 40 78 Z" fill="#e2e8f0" />
                        <path d="M43 56 Q 50 60 57 56" fill="rgba(0,0,0,0.12)" />

                        {/* Head - Positioned relative to Neck */}
                        <g transform="translate(30, 16)">
                            {/* Ears */}
                            <path d="M2 28 Q -1 28, -1 24 Q -1 20, 2 20" fill="#e2e8f0" stroke="#cbd5e0" strokeWidth="0.5" />
                            <path d="M38 28 Q 41 28, 41 24 Q 41 20, 38 20" fill="#e2e8f0" stroke="#cbd5e0" strokeWidth="0.5" />

                            {/* Face Outline */}
                            <path d="M2 20 Q 2 5, 20 5 Q 38 5, 38 20 Q 38 40, 20 44 Q 2 40, 2 20" fill="url(#faceGradient)" filter="url(#shadow)" />

                            {/* Hair */}
                            <path d="M0 22 Q 0 2, 20 2 Q 40 2, 40 22 Q 40 18, 30 16 Q 20 10, 10 16 Q 0 18, 0 22" fill="url(#hairGradient)" />

                            <g transform="translate(0, 3)">
                                <FaceFeatures state={state} />
                            </g>
                        </g>
                    </g>
                </g>
            </svg>

            <style>{`
            @keyframes breath {
                0%, 100% { transform: translateY(0) scale(1.00); }
                50% { transform: translateY(-1.5px) scale(1.005); }
            }
            @keyframes headTilt {
                0%, 100% { transform: rotate(0deg); }
                30% { transform: rotate(1deg); }
                70% { transform: rotate(-1deg); }
            }
            @keyframes blink {
                0%, 90%, 100% { transform: scaleY(1); }
                95% { transform: scaleY(0.02); }
            }
            .animate-breath {
                animation: breath 5s ease-in-out infinite;
                transform-origin: bottom;
            }
            .animate-head-tilt {
                animation: headTilt 8s ease-in-out infinite;
            }
            .animate-blink {
                animation: blink 4s infinite;
            }
        `}</style>
        </div>
    );
};
