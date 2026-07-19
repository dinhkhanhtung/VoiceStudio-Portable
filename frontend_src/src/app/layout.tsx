import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-family",
});

export const metadata: Metadata = {
  title: "Voice Studio",
  description: "Đọc văn bản, dịch và nhân bản giọng nói cá nhân.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className={outfit.variable}>
      <body className="antialiased font-sans">
        {children}
        
        {/* Credit requirements based on rule */}
        <div style={{position: 'fixed', bottom: '10px', right: '10px', fontSize: '12px', color: 'var(--muted-foreground)', zIndex: 9999}}>
          Tài trợ bởi <a href="https://kimke.store/" target="_blank" style={{color: 'var(--primary)', textDecoration: 'none'}}>kimke.store</a>
        </div>
      </body>
    </html>
  );
}
