import type {AppProps} from "next/app";
import "../styles/globals.css";
import Header from "../components/Header";

export default function App({Component, pageProps}: AppProps) {
  const AnyComponent = Component as any;
  return (
    <div className="min-h-screen bg-white text-gray-900 dark:bg-gray-950 dark:text-white">
      <Header />
      {/* Ensure page content doesn't hide behind the sticky header */}
      <div className="pt-2">
        <AnyComponent {...pageProps} />
      </div>
    </div>
  );
}
