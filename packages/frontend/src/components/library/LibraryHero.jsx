import React from 'react';
import { Search, Sparkles, BookOpen, FileCheck, Layers, X, ShieldCheck } from 'lucide-react';

export function LibraryHero({ searchQuery, onSearchChange, totalCount, activeCategoryName }) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0a1142] via-[#0f1a5c] to-[#040617] border border-[#1e2e8f]/60 p-6 sm:p-8 lg:p-9 text-white shadow-2xl shadow-[#0a1142]/30">
      {/* Ambient background glows */}
      <div 
        className="absolute -right-20 -top-20 w-96 h-96 rounded-full bg-indigo-500/15 blur-3xl pointer-events-none" 
        aria-hidden="true" 
      />
      <div 
        className="absolute left-1/2 -bottom-28 w-80 h-80 rounded-full bg-[#ffb81c]/10 blur-3xl pointer-events-none" 
        aria-hidden="true" 
      />

      <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-8">
        {/* Left Column: Brand, Title, Description, and Badges */}
        <div className="space-y-4 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-[#ffb81c] text-xs font-bold tracking-wider uppercase">
            <Sparkles className="w-3.5 h-3.5 shrink-0 text-[#ffb81c]" />
            <span>FOCIT Intellectual Repository & Vault</span>
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-white font-display">
              Digital Academic Library
            </h1>
            <p className="text-sm sm:text-base text-slate-300 leading-relaxed font-normal">
              Curated faculty textbooks, past semester examination papers, laboratory workbooks, and institutional guidelines across all computing programmes.
            </p>
          </div>

          {/* Quick Stats Chips with generous spacing */}
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 text-xs text-slate-200">
              <Layers className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="font-medium">{totalCount != null ? `${totalCount} Resources Available` : 'Catalog Indexed'}</span>
            </div>
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 text-xs text-slate-200">
              <FileCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="font-medium">Official Exam PQs (2021–2024)</span>
            </div>
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 text-xs text-slate-200">
              <BookOpen className="w-4 h-4 text-[#ffb81c] shrink-0" />
              <span className="font-medium">Category: <strong className="text-white">{activeCategoryName}</strong></span>
            </div>
          </div>
        </div>

        {/* Right Column: Prominent Search Engine Input */}
        <div className="w-full lg:w-96 xl:w-[26rem] shrink-0">
          <label htmlFor="library-global-search" className="sr-only">
            Search Digital Library
          </label>
          <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400 group-focus-within:text-[#ffb81c] transition-colors">
              <Search className="w-5 h-5" />
            </div>
            <input
              id="library-global-search"
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search title, author, course code..."
              className="w-full pl-11 pr-10 py-3.5 rounded-2xl bg-slate-900/90 hover:bg-slate-900 border border-slate-700/80 focus:border-[#ffb81c] text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-4 focus:ring-[#ffb81c]/20 transition-all shadow-xl"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-white transition-colors"
                aria-label="Clear search query"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="flex items-center justify-between px-2 pt-2 text-[11px] text-slate-400">
            <span>Indexed with PostgreSQL full-text ranking</span>
            <span className="hidden sm:inline font-mono text-[10px] bg-white/10 px-1.5 py-0.5 rounded">Ctrl + K</span>
          </div>
        </div>
      </div>
    </div>
  );
}
