import './globals.css';
import type { ReactNode } from 'react';
export const metadata={title:'BaBuLo Play',description:'Streaming, distribuição e promoção musical'};
export default function RootLayout({children}:{children:ReactNode}){return <html lang="pt"><body>{children}</body></html>}
