"use client";
import React from "react";
import GlobalLoader from "@/components/GlobalLoader";

export default function Loading() {
  return (
    <div className="flex w-full min-h-screen items-center justify-center bg-zinc-950 text-white pl-12 sm:pl-16 lg:pl-18">
      <GlobalLoader />
    </div>
  );
}
