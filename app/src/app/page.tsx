"use client";

import dynamic from "next/dynamic";

const ChestGame = dynamic(
  () => import("@/components/ChestGame").then((mod) => mod.ChestGame),
  { ssr: false, loading: () => <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">Loading...</div> }
);

export default function Home() {
  return <ChestGame />;
}
