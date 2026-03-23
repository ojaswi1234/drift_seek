import GlobalLoader from "@/components/GlobalLoader";

export default function Loading() {
  return (
    <div className="flex w-full h-[80vh] items-center justify-center">
      <GlobalLoader />
    </div>
  );
}
