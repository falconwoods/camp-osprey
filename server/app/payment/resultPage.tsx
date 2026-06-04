'use client';

import {
  Check,
  ExternalLink,
  Gift,
  HelpCircle,
  Lightbulb,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { ReturnToCampsoonButton } from './returnToCampsoonButton';

type PaymentResultPageProps = {
  tone: 'success' | 'cancel';
  status: string;
  title: string;
  message: string;
  details: Array<{
    icon: 'shield' | 'gift' | 'refresh' | 'dot';
    title?: string;
    text: string;
  }>;
  sideTitle: string;
  sideMessage?: string;
  sideFooterTitle?: string;
  closingNote: string;
  showTryAgain?: boolean;
};

const toneStyles = {
  success: {
    iconWrap: 'bg-[#07934f] text-white ring-[#d6f2e3]',
    halo: 'bg-[#dbf3e7]',
    badge: 'bg-[#e5f5ec] text-[#087743]',
    border: 'border-[#b9e4cf]',
    sideIcon: <ListChecks className="h-6 w-6" aria-hidden="true" />,
    statusIcon: <Check className="h-16 w-16 stroke-[4]" aria-hidden="true" />,
    accentText: 'text-[#087743]',
    accentBg: 'bg-[#087743]',
    action: 'bg-[#fb4b18] text-white shadow-[0_16px_34px_rgba(251,75,24,0.26)] hover:bg-[#e94314] focus:ring-[#fb4b18]',
  },
  cancel: {
    iconWrap: 'bg-[#fb4b18] text-white ring-[#ffe0d4]',
    halo: 'bg-[#ffe4da]',
    badge: 'bg-[#ffe9e4] text-[#bf2a0b]',
    border: 'border-[#ffb99f]',
    sideIcon: <HelpCircle className="h-6 w-6" aria-hidden="true" />,
    statusIcon: <X className="h-16 w-16 stroke-[4]" aria-hidden="true" />,
    accentText: 'text-[#e94314]',
    accentBg: 'bg-[#e94314]',
    action: 'bg-[#fb4b18] text-white shadow-[0_16px_34px_rgba(251,75,24,0.26)] hover:bg-[#e94314] focus:ring-[#fb4b18]',
  },
} satisfies Record<PaymentResultPageProps['tone'], {
  iconWrap: string;
  halo: string;
  badge: string;
  border: string;
  sideIcon: ReactNode;
  statusIcon: ReactNode;
  accentText: string;
  accentBg: string;
  action: string;
}>;

const detailIcons = {
  shield: <ShieldCheck className="h-8 w-8" aria-hidden="true" />,
  gift: <Gift className="h-8 w-8" aria-hidden="true" />,
  refresh: <RefreshCw className="h-8 w-8" aria-hidden="true" />,
  dot: null,
} satisfies Record<PaymentResultPageProps['details'][number]['icon'], ReactNode>;

const sparklePositions = [
  'left-2 top-0 h-2 w-2',
  'right-3 top-1 h-2.5 w-2.5',
  'left-0 top-7 h-1.5 w-1.5 opacity-40',
  'right-0 top-8 h-1.5 w-1.5 opacity-40',
];

function StatusMark({ tone }: { tone: PaymentResultPageProps['tone'] }) {
  const styles = toneStyles[tone];

  return (
    <div className="relative mx-auto h-32 w-32 shrink-0 lg:mx-0">
      {sparklePositions.map(position => (
        <span
          key={position}
          className={`absolute rotate-45 rounded-[2px] ${position} ${styles.accentBg}`}
          aria-hidden="true"
        />
      ))}
      <div className={`absolute inset-4 rounded-full ${styles.halo}`} />
      <div className={`absolute inset-0 m-auto flex h-[104px] w-[104px] items-center justify-center rounded-full ring-[16px] ${styles.iconWrap}`}>
        {styles.statusIcon}
      </div>
    </div>
  );
}

function DetailIcon({ tone, icon }: { tone: PaymentResultPageProps['tone']; icon: PaymentResultPageProps['details'][number]['icon'] }) {
  const styles = toneStyles[tone];

  if (icon === 'dot') {
    return <span className={`mt-3 h-2 w-2 shrink-0 rounded-full ${styles.accentBg}`} aria-hidden="true" />;
  }

  return (
    <span className={`flex h-[58px] w-[58px] shrink-0 items-center justify-center rounded-full ${styles.halo} ${styles.accentText} ring-1 ring-inset ${styles.border}`}>
      {detailIcons[icon]}
    </span>
  );
}

function TryAgainButton() {
  return (
    <button
      className={`inline-flex h-[58px] w-full max-w-[310px] items-center justify-center gap-3 rounded-full px-8 text-xl font-extrabold tracking-normal transition focus:outline-none focus:ring-2 focus:ring-offset-2 ${toneStyles.cancel.action}`}
      type="button"
      onClick={() => window.history.back()}
    >
      <RefreshCw className="h-6 w-6" aria-hidden="true" />
      Try Again
    </button>
  );
}

function SecondaryReturnButton() {
  return (
    <ReturnToCampsoonButton
      className="inline-flex h-[58px] w-full max-w-[310px] items-center justify-center gap-3 rounded-full border border-[#d7dee8] bg-white px-8 text-xl font-extrabold tracking-normal text-[#111827] shadow-none transition hover:bg-[#f8fafc] focus:outline-none focus:ring-2 focus:ring-[#111827] focus:ring-offset-2"
      icon={<ExternalLink className="h-6 w-6" aria-hidden="true" />}
    />
  );
}

function Divider({ tone }: { tone: PaymentResultPageProps['tone'] }) {
  return <div className={`h-px w-full ${tone === 'success' ? 'bg-[#d8e2df]' : 'bg-[#eadbd5]'}`} />;
}

function DetailRows({ tone, details }: Pick<PaymentResultPageProps, 'tone' | 'details'>) {
  if (tone === 'cancel') {
    return (
      <ul className="mt-5 space-y-4 text-[17px] leading-7 text-[#526174]">
        {details.map(detail => (
          <li key={detail.text} className="flex gap-4">
            <DetailIcon tone={tone} icon={detail.icon} />
            <span>{detail.text}</span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="mt-8 space-y-6">
      {details.map((detail, index) => (
        <div key={detail.text}>
          {index > 0 ? <Divider tone={tone} /> : null}
          <div className={index > 0 ? 'flex gap-5 pt-6' : 'flex gap-5'}>
            <DetailIcon tone={tone} icon={detail.icon} />
            <div>
              {detail.title ? <h2 className="text-[18px] font-extrabold leading-7 text-[#1c2638]">{detail.title}</h2> : null}
              <p className="mt-1 text-[17px] leading-7 text-[#526174]">{detail.text}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SidePanel({
  tone,
  sideTitle,
  sideMessage,
  sideFooterTitle,
  details,
}: Pick<PaymentResultPageProps, 'tone' | 'sideTitle' | 'sideMessage' | 'sideFooterTitle' | 'details'>) {
  const styles = toneStyles[tone];

  return (
    <aside className={`rounded-[14px] border ${styles.border} bg-white/80 p-8 shadow-[0_18px_50px_rgba(15,23,42,0.04)] sm:p-9`}>
      <div className="flex items-center gap-4">
        <span className={styles.accentText}>{styles.sideIcon}</span>
        <h2 className="text-[22px] font-extrabold tracking-normal text-[#111827]">{sideTitle}</h2>
      </div>

      {sideMessage ? <p className="mt-7 text-[17px] leading-7 text-[#526174]">{sideMessage}</p> : null}
      {sideMessage ? <div className="mt-8"><Divider tone={tone} /></div> : null}

      {sideFooterTitle ? (
        <div className="mt-8 flex items-center gap-4">
          <Lightbulb className="h-7 w-7 text-[#fb4b18]" aria-hidden="true" />
          <h3 className="text-[20px] font-extrabold tracking-normal text-[#111827]">{sideFooterTitle}</h3>
        </div>
      ) : null}

      <DetailRows tone={tone} details={details} />
    </aside>
  );
}

export function PaymentResultPage({
  tone,
  status,
  title,
  message,
  details,
  sideTitle,
  sideMessage,
  sideFooterTitle,
  closingNote,
  showTryAgain = false,
}: PaymentResultPageProps) {
  const styles = toneStyles[tone];

  return (
    <main className="min-h-screen bg-[#f5f7f8] px-4 py-6 text-[#111827] sm:px-8">
      <section className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-[1280px] items-center">
        <div className="w-full rounded-[14px] border border-[#d9dee5] bg-white px-6 py-10 shadow-[0_18px_60px_rgba(15,23,42,0.08)] sm:px-12 lg:px-16 lg:py-22">
          <div className="grid items-center gap-10 lg:grid-cols-[1.35fr_1fr] lg:gap-16">
            <div className="grid gap-8 text-center lg:grid-cols-[140px_1fr] lg:text-left">
              <StatusMark tone={tone} />
              <div>
                <p className={`inline-flex rounded-full px-5 py-2 text-base font-extrabold ${styles.badge}`}>{status}</p>
                <h1 className="mt-7 max-w-[620px] text-[34px] font-black leading-tight tracking-normal text-[#0f172a] sm:text-[42px]">
                  {title}
                </h1>
                <p className="mt-7 max-w-[620px] text-[18px] leading-8 text-[#526174]">{message}</p>

                <div className="mt-10 flex flex-col items-center gap-4 lg:items-start">
                  {showTryAgain ? <TryAgainButton /> : <ReturnToCampsoonButton />}
                  {showTryAgain ? <SecondaryReturnButton /> : null}
                </div>

                <p className="mt-7 max-w-[620px] text-[16px] leading-7 text-[#526174]">{closingNote}</p>
              </div>
            </div>

            <SidePanel
              tone={tone}
              sideTitle={sideTitle}
              sideMessage={sideMessage}
              sideFooterTitle={sideFooterTitle}
              details={details}
            />
          </div>
        </div>
      </section>
    </main>
  );
}
