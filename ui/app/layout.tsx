import type { Metadata } from "next";
import "./globals.css";
import ConditionalLayout from "@/components/ConditionalLayout";
import { AgentRunProvider } from "@/context/AgentRunContext";
import { AddProductsProvider } from "@/context/AddProductsContext";

export const metadata: Metadata = {
  title: "HolloEngine",
  description: "HolloEngine Pipeline Dashboard",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AgentRunProvider>
          <AddProductsProvider>
            <ConditionalLayout>{children}</ConditionalLayout>
          </AddProductsProvider>
        </AgentRunProvider>
      </body>
    </html>
  );
}
