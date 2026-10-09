'use client';

import React from 'react';
import { Play, Pause, RotateCcw, FastForward, Eye, Compass, Navigation } from 'lucide-react';
import type { Route } from '@/types';

interface TrailFollowHUDProps {
  route: Route;
  isFollowing: boolean;
  isPaused: boolean;
  progressRatio: number;
  currentDistanceKm: number;
  totalDistanceKm: number;
  currentLandmark: string | null;
  speedMultiplier: 1 | 2;
  isArrived: boolean;
  language: 'ja' | 'en' | 'zh';
  onTogglePlayPause: () => void;
  onReplay: () => void;
  onSpeedToggle: () => void;
  onSeek: (ratio: number) => void;
  onStopAndOverview: () => void;
  onResumeFollow: () => void;
}

export function TrailFollowHUD({
  route,
  isFollowing,
  isPaused,
  progressRatio,
  currentDistanceKm,
  totalDistanceKm,
  currentLandmark,
  speedMultiplier,
  isArrived,
  language,
  onTogglePlayPause,
  onReplay,
  onSpeedToggle,
  onSeek,
  onStopAndOverview,
  onResumeFollow,
}: TrailFollowHUDProps) {
  if (!isFollowing) return null;

  const routeName = language === 'en'
    ? route.name_en || route.name
    : language === 'zh'
    ? route.name_zh || route.name
    : route.name;

  const percent = Math.min(100, Math.max(0, Math.round(progressRatio * 100)));

  const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1.0, clickX / rect.width));
    onSeek(ratio);
  };

  return (
    <div
      className="absolute bottom-[175px] md:bottom-[190px] lg:bottom-[200px] left-1/2 -translate-x-1/2 z-30 w-[94%] max-w-[540px] pointer-events-auto select-none animate-fadeInUp"
      style={{ animationDuration: '300ms' }}
    >
      {/* ── Resume follow pill if user panned away in free-look mode ── */}
      {isPaused && !isArrived && (
        <div className="flex justify-center mb-2">
          <button
            onClick={onResumeFollow}
            className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-500/90 hover:bg-cyan-400 text-black font-black text-xs shadow-[0_0_20px_rgba(6,182,212,0.6)] backdrop-blur-md transition-all active:scale-95 animate-pulse"
          >
            <Navigation className="w-3.5 h-3.5 fill-black" />
            <span>
              {language === 'en'
                ? 'Resume Aerial Follow Camera'
                : language === 'zh'
                ? '恢复追踪跟拍镜头'
                : '追従カメラを再開'}
            </span>
          </button>
        </div>
      )}

      {/* ── Main Glassmorphic Follow HUD Card ── */}
      <div className="relative rounded-2xl bg-[#060F1E]/95 backdrop-blur-xl border border-cyan-400/40 p-3 md:p-3.5 shadow-[0_12px_36px_rgba(0,0,0,0.85)] ring-1 ring-cyan-500/20">
        {/* Top Header: Badge, Route Name & Live Landmark */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-cyan-400/15 border border-cyan-400/40 text-cyan-300 font-mono font-bold text-[10px] tracking-wider shrink-0">
              <span className={`w-2 h-2 rounded-full ${isPaused ? 'bg-amber-400' : 'bg-cyan-400 animate-ping'}`} />
              🚁 {language === 'en' ? 'PRO FOLLOW' : '追従カメラ'}
            </span>
            <span className="text-white font-bold text-xs truncate max-w-[200px] sm:max-w-[260px]">
              {routeName}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isArrived ? (
              <span className="text-[11px] font-bold text-emerald-400 bg-emerald-500/15 px-2 py-0.5 rounded-md border border-emerald-500/30">
                🏁 {language === 'en' ? 'Summit Arrived!' : language === 'zh' ? '到达终点！' : 'ゴール到達！'}
              </span>
            ) : isPaused ? (
              <span className="text-[10px] font-medium text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded-md border border-amber-500/30">
                ⏸️ {language === 'en' ? 'Free Look' : language === 'zh' ? '自由视点' : '自由視点'}
              </span>
            ) : (
              <span className="text-[10px] font-medium text-cyan-300 bg-cyan-500/15 px-2 py-0.5 rounded-md border border-cyan-500/30 font-mono">
                {speedMultiplier}x
              </span>
            )}
          </div>
        </div>

        {/* Scenic Landmark Callout (Dynamic while flying) */}
        {currentLandmark && (
          <div className="mb-2 px-2.5 py-1 rounded-lg bg-cyan-950/60 border border-cyan-400/30 flex items-center gap-2 text-cyan-200 text-[11px] font-medium animate-fadeIn">
            <span className="text-cyan-400">📍</span>
            <span className="truncate">{currentLandmark}</span>
          </div>
        )}

        {/* Interactive Scrubbing Progress Bar */}
        <div className="space-y-1 mb-2.5">
          <div
            onClick={handleProgressBarClick}
            className="w-full h-2 rounded-full bg-slate-800/90 relative cursor-pointer group overflow-hidden border border-white/10"
            title={language === 'en' ? 'Click to jump to point on trail' : 'クリックしてトレイル上の位置へ移動'}
          >
            {/* Walked progress gradient */}
            <div
              className="h-full bg-gradient-to-r from-cyan-400 via-teal-300 to-cyan-200 transition-all duration-75 relative rounded-full"
              style={{ width: `${percent}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-[0_0_8px_#0AFFE0] scale-110" />
            </div>
          </div>

          <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 font-semibold px-0.5">
            <span className="text-cyan-300">
              {currentDistanceKm.toFixed(1)} km / {totalDistanceKm.toFixed(1)} km
            </span>
            <span>{percent}%</span>
          </div>
        </div>

        {/* Action Controls Row */}
        <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-white/10">
          <div className="flex items-center gap-1.5">
            {/* Play / Pause */}
            <button
              onClick={onTogglePlayPause}
              className="px-2.5 py-1 rounded-lg bg-cyan-400/20 hover:bg-cyan-400/30 border border-cyan-400/50 text-cyan-200 flex items-center gap-1.5 text-xs font-bold transition-all active:scale-95"
              title={isPaused ? '再生' : '一時停止'}
            >
              {isPaused ? <Play className="w-3.5 h-3.5 fill-cyan-300 text-cyan-300" /> : <Pause className="w-3.5 h-3.5 text-cyan-300" />}
              <span>{isPaused ? (language === 'en' ? 'Play' : '再生') : (language === 'en' ? 'Pause' : '停止')}</span>
            </button>

            {/* Replay */}
            <button
              onClick={onReplay}
              className="p-1 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-300 hover:text-white transition-all active:scale-95"
              title={language === 'en' ? 'Replay from start' : '最初から再生'}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            {/* Speed Toggle (1x / 2x) */}
            <button
              onClick={onSpeedToggle}
              className="px-2 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-300 hover:text-cyan-300 font-mono text-xs font-bold transition-all active:scale-95"
              title={language === 'en' ? 'Toggle flight speed (1x / 2x)' : '飛行速度切替 (1x / 2x)'}
            >
              {speedMultiplier === 1 ? '1x' : '2x ⚡'}
            </button>
          </div>

          {/* Overview button (exits follow mode and shows entire mountain) */}
          <button
            onClick={onStopAndOverview}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-all active:scale-95"
            title={language === 'en' ? 'Exit follow & view whole mountain overview' : '全体俯瞰表示に戻る'}
          >
            <Eye className="w-3.5 h-3.5 text-slate-400" />
            <span>{language === 'en' ? 'Overview' : '全体俯瞰'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
