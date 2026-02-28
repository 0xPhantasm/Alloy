"use client";

import Link from "next/link";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

const STEPS = [
  {
    n: '01',
    title: 'Connect Your Wallet',
    desc: 'Install Phantom (or any supported Solana wallet) and make sure you have SOL available.',
    note: (
      <>
        Need devnet SOL? Head to{' '}
        <a
          href="https://faucet.solana.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-purple-400 hover:text-purple-300 underline"
        >
          Solana Faucet
        </a>
      </>
    ),
  },
  {
    n: '02',
    title: 'Set Your Stake',
    desc: 'Choose how much SOL to bet (0.1 – 1.0 SOL) and how many chests to play with (2 – 5). More chests means a lower chance of winning but a proportionally bigger payout.',
    note: null,
  },
  {
    n: '03',
    title: 'Pick a Chest',
    desc: 'Select the chest you think hides the reward. Your choice is encrypted client-side using x25519 key exchange before it is sent on-chain — not even the network can see your pick until it is decrypted inside the MPC circuit.',
    note: null,
  },
  {
    n: '04',
    title: 'Wait for the Reveal',
    desc: "Arcium's MPC nodes decrypt your choice, generate a cryptographically random winning chest, compare the two, and write the signed result back to Solana.",
    note: 'You can cancel and get a refund if computation stalls beyond 60 seconds.',
  },
  {
    n: '05',
    title: 'Collect Your Winnings',
    desc: 'If your chest matches the winning chest, the payout is transferred directly to your wallet: Bet × Number of Chests. If not, the bet is kept in the treasury for future winners.',
    note: null,
  },
];

const ODDS = [
  { chests: 2, chance: '50%', multiplier: '2×', example: '0.5 SOL → 1.0 SOL' },
  { chests: 3, chance: '33%', multiplier: '3×', example: '0.5 SOL → 1.5 SOL' },
  { chests: 4, chance: '25%', multiplier: '4×', example: '0.5 SOL → 2.0 SOL' },
  { chests: 5, chance: '20%', multiplier: '5×', example: '0.5 SOL → 2.5 SOL' },
];

export default function HowToPlayPage() {
  return (
    <div className="relative min-h-screen flex flex-col" style={{ background: '#050810', color: '#ededed' }}>
      {/* Background */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(88,28,135,0.22) 0%, rgba(5,8,16,0.92) 70%)',
        }}
      />
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(168,85,247,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(168,85,247,0.6) 1px, transparent 1px)',
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
              background: 'rgba(8,10,22,0.82)',
              backdropFilter: 'blur(14px)',
              border: '1px solid rgba(168,85,247,0.18)',
            }}
          >
            {/* Logo */}
            <Link href="/" className="flex items-center gap-2.5">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(88,28,135,0.55)', border: '1px solid rgba(168,85,247,0.35)' }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M3 7h18v12H3z" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M3 7l9-4 9 4" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M9 11h6" stroke="#a855f7" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
              <span className="text-base font-bold tracking-wide" style={{ color: '#a855f7' }}>
                VeiledChests
              </span>
            </Link>

            {/* Nav */}
            <nav className="hidden md:flex gap-7 text-sm font-medium">
              <Link href="/" className="text-gray-500 hover:text-purple-300 transition-colors duration-200">Game</Link>
              <Link href="/about" className="text-gray-500 hover:text-purple-300 transition-colors duration-200">About</Link>
              <Link href="/how-to-play" className="text-purple-300 transition-colors duration-200">How to Play</Link>
            </nav>

            {/* Wallet */}
            <WalletMultiButton />
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 px-6 py-16 max-w-3xl mx-auto w-full">

          {/* Hero */}
          <div className="text-center mb-14 anim-fade-up">
            <h1 className="text-5xl font-black mb-4 leading-tight">
              <span className="text-white">How to </span>
              <span className="shimmer-text">Play</span>
            </h1>
            <p className="text-gray-400 text-lg leading-relaxed max-w-md mx-auto">
              Five steps from wallet connect to payout. No signup, no custody, no trust required.
            </p>
          </div>

          {/* Steps */}
          <div className="flex flex-col gap-4 mb-12 anim-reveal">
            {STEPS.map(({ n, title, desc, note }) => (
              <div
                key={n}
                className="flex gap-5 rounded-2xl p-6"
                style={{
                  background: 'rgba(8,10,24,0.85)',
                  border: '1px solid rgba(168,85,247,0.14)',
                  backdropFilter: 'blur(14px)',
                }}
              >
                {/* Step number */}
                <div
                  className="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center font-mono text-sm font-bold"
                  style={{
                    background: 'rgba(88,28,135,0.35)',
                    border: '1px solid rgba(168,85,247,0.35)',
                    color: '#c084fc',
                  }}
                >
                  {n}
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-bold text-white mb-1.5">{title}</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">{desc}</p>
                  {note && (
                    <p
                      className="mt-2.5 text-xs px-3 py-1.5 rounded-lg inline-block font-mono"
                      style={{
                        background: 'rgba(168,85,247,0.08)',
                        border: '1px solid rgba(168,85,247,0.18)',
                        color: '#a78bfa',
                      }}
                    >
                      {note}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Odds table */}
          <div
            className="rounded-2xl overflow-hidden mb-12"
            style={{
              background: 'rgba(8,10,24,0.85)',
              border: '1px solid rgba(168,85,247,0.16)',
              backdropFilter: 'blur(14px)',
            }}
          >
            <div
              className="px-6 py-4 border-b"
              style={{ borderColor: 'rgba(168,85,247,0.14)' }}
            >
              <h2 className="text-base font-bold text-white">Odds &amp; Payouts</h2>
              <p className="text-gray-600 text-xs mt-0.5">Expected value = your bet, always.</p>
            </div>

            <div className="divide-y" style={{ borderColor: 'rgba(168,85,247,0.08)' }}>
              {/* Column headers */}
              <div className="grid grid-cols-4 px-6 py-2.5">
                {['Chests', 'Win Chance', 'Multiplier', 'Example (0.5 SOL)'].map((h) => (
                  <span key={h} className="text-[11px] font-bold uppercase tracking-wider text-gray-600">{h}</span>
                ))}
              </div>
              {ODDS.map(({ chests, chance, multiplier, example }) => (
                <div
                  key={chests}
                  className="grid grid-cols-4 px-6 py-3.5 transition-colors"
                  style={{ borderColor: 'rgba(168,85,247,0.08)' }}
                >
                  <span className="text-sm font-bold text-white">{chests}</span>
                  <span className="text-sm text-yellow-400 font-semibold">{chance}</span>
                  <span className="text-sm text-green-400 font-semibold">{multiplier}</span>
                  <span className="text-sm text-gray-400">{example}</span>
                </div>
              ))}
            </div>
          </div>

          {/* CTA */}
          <div className="text-center">
            <Link
              href="/"
              className="inline-block px-10 py-3.5 rounded-xl font-bold text-sm transition-all duration-200 hover:scale-105 active:scale-95"
              style={{
                background: 'linear-gradient(135deg, rgba(180,90,0,0.9), rgba(217,119,6,0.95))',
                border: '2px solid rgba(245,158,11,0.65)',
                color: '#fff7ed',
                boxShadow: '0 0 28px rgba(245,158,11,0.28)',
              }}
            >
              Open the Veil
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
                className="text-gray-500 hover:text-purple-400 transition-colors"
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
