import "~~/styles/globals.css";

export const metadata = {
  title: "Hana · Bonzo on Hedera",
  description: "Read-only Bonzo lending monitoring with replayable Hedera receipts.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
