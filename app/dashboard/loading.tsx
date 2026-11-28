"use client";
import React from "react";
import GlobalLoader from "@/components/GlobalLoader";

export default function Loading() {
  return (
    <div className="flex w-full min-h-[80vh] items-center justify-center bg-white text-zinc-900 pl-12 sm:pl-16 lg:pl-18">
      <GlobalLoader />
    </div>
  );
}
