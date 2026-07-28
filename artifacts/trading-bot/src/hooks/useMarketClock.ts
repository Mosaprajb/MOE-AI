// MOE-AI Market Clock — live ET time + US trading session detection
import { useEffect, useState } from 'react';

export type MarketSession = 'PRE-MARKET' | 'CORE' | 'AFTER-HOURS' | 'CLOSED';

export interface MarketClockState {
  timeET:  string;   // "09:34:21 AM"
  dateET:  string;   // "Mon Jul 28"
  session: MarketSession;
  open:    boolean;  // true during PRE-MARKET, CORE, AFTER-HOURS
  nextLabel: string; // "Opens in 1h 23m" / "Core in 14m" / "Closes in 2h 07m"
}

function getETDate(): Date {
  // Shift system time to Eastern Time using Intl API
  const now = new Date();
  const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  return new Date(etStr);
}

function minutesSinceMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function hhmmss(d: Date): string {
  return d.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function dateShort(d: Date): string {
  return d.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month:   'short',
    day:     'numeric',
  });
}

function minsToLabel(mins: number): string {
  if (mins <= 0)   return 'Now';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0)     return `${m}m`;
  if (m === 0)     return `${h}h`;
  return `${h}h ${m}m`;
}

function getSession(et: Date): { session: MarketSession; open: boolean; nextLabel: string } {
  const dow = et.getDay();           // 0 = Sun, 6 = Sat
  const mins = minutesSinceMidnight(et);

  // Weekends — always closed
  if (dow === 0 || dow === 6) {
    const daysToMon = dow === 0 ? 1 : 2;
    return { session: 'CLOSED', open: false, nextLabel: `Opens Mon ${daysToMon === 1 ? 'tomorrow' : 'in 2d'}` };
  }

  // Weekdays: boundaries in minutes since midnight ET
  const PRE_START  = 4  * 60;        // 4:00 AM
  const CORE_START = 9  * 60 + 30;   // 9:30 AM
  const CORE_END   = 16 * 60;        // 4:00 PM
  const AH_END     = 20 * 60;        // 8:00 PM

  if (mins < PRE_START) {
    return { session: 'CLOSED',      open: false, nextLabel: `Pre-market in ${minsToLabel(PRE_START  - mins)}` };
  }
  if (mins < CORE_START) {
    return { session: 'PRE-MARKET',  open: true,  nextLabel: `Core opens in ${minsToLabel(CORE_START - mins)}` };
  }
  if (mins < CORE_END) {
    return { session: 'CORE',        open: true,  nextLabel: `Closes in ${minsToLabel(CORE_END - mins)}` };
  }
  if (mins < AH_END) {
    return { session: 'AFTER-HOURS', open: true,  nextLabel: `After-hours ends in ${minsToLabel(AH_END - mins)}` };
  }
  // 8 PM – midnight: check if next day is a weekday
  const nextOpen = dow === 5 ? 'Mon' : 'tomorrow';
  return { session: 'CLOSED', open: false, nextLabel: `Pre-market ${nextOpen} 4 AM ET` };
}

export function useMarketClock(): MarketClockState {
  const [state, setState] = useState<MarketClockState>(() => {
    const et = getETDate();
    const { session, open, nextLabel } = getSession(et);
    return { timeET: hhmmss(new Date()), dateET: dateShort(et), session, open, nextLabel };
  });

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const et  = getETDate();
      const { session, open, nextLabel } = getSession(et);
      setState({ timeET: hhmmss(now), dateET: dateShort(et), session, open, nextLabel });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return state;
}
