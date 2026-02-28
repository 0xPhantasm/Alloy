"use client";

import Link from "next/link";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function AboutPage() {
  return (
    <div className="relative min-h-screen flex flex-col" style={{ background: '#050505', color: '#ededed' }}>
      {/* Background */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(255,255,255,0.04) 0%, rgba(5,5,5,0.95) 70%)',
        }}
      />
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* Page shell */}
      <div className="relative z-10 flex flex-col min-h-screen">

        {/* Header */}
        <header className="flex-shrink-0 px-5 pt-5">
          <div
            className="max-w-6xl mx-auto flex items-center justify-between px-5 py-3 rounded-xl"
            style={{
              background: 'rgba(5,5,5,0.85)',
              backdropFilter: 'blur(14px)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            {/* Logo */}
            <Link href="/" className="flex items-center gap-2.5">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)' }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M3 7h18v12H3z" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M3 7l9-4 9 4" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M9 11h6" stroke="#ffffff" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
              <span className="text-base font-bold tracking-wide" style={{ color: '#ffffff' }}>
                VeiledChests
              </span>
            </Link>

            {/* Nav */}
            <nav className="hidden md:flex gap-7 text-sm font-medium">
              <Link href="/" className="text-gray-500 hover:text-white transition-colors duration-200">Game</Link>
              <Link href="/about" className="text-white transition-colors duration-200">About</Link>
              <Link href="/how-to-play" className="text-gray-500 hover:text-white transition-colors duration-200">How to Play</Link>
            </nav>

            {/* Wallet */}
            <WalletMultiButton />
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 px-6 py-16 max-w-3xl mx-auto w-full">

          {/* Hero */}
          <div className="text-center mb-16 anim-fade-up">
            <div
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-6 text-xs font-semibold tracking-widest uppercase"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.18)',
                color: '#e5e5e5',
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              Powered by Arcium MPC · Solana
            </div>
            <h1 className="text-5xl font-black mb-4 leading-tight">
              <span className="text-white">About </span>
              <span className="shimmer-text">VeiledChests</span>
            </h1>
            <p className="text-gray-400 text-lg leading-relaxed max-w-xl mx-auto">
              A chest guessing game where the outcome is mathematically guaranteed to be fair — not just promised.
            </p>
          </div>

          {/* Cards */}
          <div className="flex flex-col gap-6 anim-reveal">

            {/* Problem */}
            <div
              className="rounded-2xl p-7"
              style={{
                background: 'rgba(10,10,10,0.85)',
                border: '1px solid rgba(255,255,255,0.08)',
                backdropFilter: 'blur(14px)',
              }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <h2 className="text-lg font-bold text-white">The Problem with the Traditional Method</h2>
              </div>
              <p className="text-gray-400 leading-relaxed mb-3">
                Casinos with similar games have always asked players to <span className="text-gray-200">trust the house</span>. Winning outcomes are computed on private servers — opaque, unverifiable, and easy to manipulate. Even games that claim to be "provably fair" often rely on server-side seeds that can be swapped after the fact.
              </p>
              <p className="text-gray-500 leading-relaxed">
                There is no technical guarantee that the house isn't cheating. You're staking on blind faith.
              </p>
            </div>

            {/* Solution */}
            <div
              className="rounded-2xl p-7"
              style={{
                background: 'rgba(10,10,10,0.85)',
                border: '1px solid rgba(255,255,255,0.14)',
                backdropFilter: 'blur(14px)',
                boxShadow: '0 0 40px rgba(255,255,255,0.03)',
              }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="11" width="18" height="11" rx="2" stroke="#ffffff" strokeWidth="2"/>
                    <path d="M7 11V7a5 5 0 0110 0v4" stroke="#ffffff" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </div>
                <h2 className="text-lg font-bold text-white">How VeiledChests Is Different</h2>
              </div>
              <p className="text-gray-400 leading-relaxed mb-4">
                It is built on <span className="text-white font-semibold">Arcium's Multi-Party Computation (MPC) network</span> on Solana. Here's what that means in practice:
              </p>
              <div className="flex flex-col gap-3">
                {[
                  {
                    title: 'Your choice is private',
                    desc: 'When you pick a chest, your selection is encrypted client-side using x25519 key exchange before it ever leaves your browser.',
                  },
                  {
                    title: 'No one controls the result',
                    desc: "Arcium's network of independent decentralised MPC nodes decrypts your choice and generates the winning chest using verifiable randomness. No single node — and not us — can see or influence the outcome.",
                  },
                  {
                    title: 'Every result is signed and on-chain',
                    desc: 'The outcome is verified from the Arcium cluster and written to Solana. Anyone can audit the computation after the fact.',
                  },
                ].map(({ title, desc }) => (
                  <div key={title} className="flex gap-3">
                    <span
                      className="mt-0.5 w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center"
                      style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.25)' }}
                    >
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none">
                        <path d="M5 13l4 4L19 7" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
                    <div>
                      <p className="text-gray-200 font-semibold text-sm">{title}</p>
                      <p className="text-gray-500 text-sm leading-relaxed mt-0.5">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Zero house edge */}
            <div
              className="rounded-2xl p-7"
              style={{
                background: 'rgba(10,10,10,0.85)',
                border: '1px solid rgba(34,197,94,0.18)',
                backdropFilter: 'blur(14px)',
              }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <h2 className="text-lg font-bold text-white">Zero House Edge</h2>
              </div>
              <p className="text-gray-400 leading-relaxed mb-4">
                VeiledChests takes no cut. The payout formula is simple:
              </p>
              <div
                className="rounded-xl px-5 py-4 mb-4 text-center"
                style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.18)' }}
              >
                <p className="text-green-400 font-mono text-lg font-bold">Win = Bet × Number of Chests</p>
                <p className="text-gray-600 text-xs mt-1">Expected value = your original bet. Always.</p>
              </div>
              <p className="text-gray-500 leading-relaxed">
                With 3 chests you have a 1-in-3 chance of winning 3× your bet. With 5 chests, 1-in-5 chance of winning 5×. The math is symmetric — the game stays funded through the natural variance of fair play, not by tilting the odds against you.
              </p>
            </div>

          </div>

          {/* CTA */}
          <div className="text-center mt-12">
            <Link
              href="/"
              className="inline-block px-10 py-3.5 rounded-xl font-bold text-sm transition-all duration-200 hover:scale-105 active:scale-95"
              style={{
                background: '#ffffff',
                border: '1px solid rgba(255,255,255,0.9)',
                color: '#000000',
                boxShadow: '0 0 28px rgba(255,255,255,0.12)',
              }}
            >
              Play Now
            </Link>
          </div>

          {/* Footer */}
          <footer className="text-center mt-12">
            <p className="text-gray-700 text-xs">
              Built by{' '}
              <a
                href="https://x.com/EtherPhantasm"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-500 hover:text-white transition-colors"
              >
                EtherPhantasm
              </a>
            </p>
          </footer>

        </main>
      </div>
    </div>
  );
}
