//+------------------------------------------------------------------+
//|                                              GoldStackPropEA.mq5 |
//|     XAUUSD stacked-entry trend scalper with prop-firm risk guard  |
//+------------------------------------------------------------------+
#property copyright   "GoldStack"
#property version     "1.00"
#property description "XAUUSD-only trend-pullback scalper. Each trade is split into a stack of"
#property description "positions with staggered take-profits, protected by prop-firm daily and"
#property description "total loss limits, a spread/volatility/session filter and a news filter."

#include <Trade/Trade.mqh>

//+------------------------------------------------------------------+
//| Guard states                                                      |
//+------------------------------------------------------------------+
enum ENUM_GUARD_STATE
  {
   GUARD_OK          = 0,
   GUARD_DAILY_LOCK  = 1,
   GUARD_TOTAL_LOCK  = 2,
   GUARD_TARGET_LOCK = 3
  };

//+------------------------------------------------------------------+
//| Inputs                                                            |
//+------------------------------------------------------------------+
input group "=== General ==="
input ulong  InpMagic             = 20261013;  // Magic number
input bool   InpAllowNonGold      = false;     // Allow non-XAU symbols (testing only)
input int    InpSlippagePoints    = 30;        // Max slippage (points)
input bool   InpVerboseLog        = true;      // Verbose journal logging
input bool   InpResetGuardState   = false;     // Reset saved guard state on attach

input group "=== Prop firm rules ==="
input double InpInitialBalance    = 0.0;   // Challenge starting balance (0 = balance on first attach)
input double InpDailyLossPct      = 5.0;   // Firm max daily loss (% of starting balance)
input double InpMaxLossPct        = 10.0;  // Firm max total loss (% of starting balance)
input double InpSafetyBufferPct   = 1.0;   // Stop this many % before each firm limit
input double InpProfitTargetPct   = 10.0;  // Stop trading after this profit % (0 = off)
input int    InpDayResetHour      = 0;     // Server hour when the firm's trading day resets
input bool   InpDayRefMaxBalEq    = true;  // Day reference = max(balance, equity) at reset
input bool   InpGuardClosesAll    = true;  // On a limit breach close ALL account positions

input group "=== Risk ==="
input double InpRiskPerBasketPct  = 0.5;   // Risk per basket if full SL is hit (% of balance)
input double InpMaxRoomUsePct     = 50.0;  // Never risk more than this % of remaining daily room
input int    InpStackCount        = 4;     // Positions per basket (hedging accounts)
input double InpMaxBasketLots     = 2.0;   // Hard cap on total basket lots
input double InpCommissionPerLot  = 7.0;   // Round-turn commission per lot (account currency)
input double InpMaxMarginUsePct   = 30.0;  // Max % of free margin a basket may use
input int    InpMaxBasketsPerDay  = 6;     // Max baskets per trading day
input int    InpMaxConsecLosses   = 3;     // Lock the day after N losing baskets in a row

input group "=== Strategy ==="
input ENUM_TIMEFRAMES InpTrendTF  = PERIOD_M15; // Trend timeframe
input int    InpTrendFastEMA      = 50;    // Trend fast EMA
input int    InpTrendSlowEMA      = 200;   // Trend slow EMA
input ENUM_TIMEFRAMES InpEntryTF  = PERIOD_M5;  // Entry timeframe
input int    InpEntryEMA          = 20;    // Entry pullback EMA
input int    InpRsiPeriod         = 14;    // Entry RSI period
input double InpRsiBuyMin         = 52.0;  // Buy only if RSI at or above
input double InpRsiSellMax        = 48.0;  // Sell only if RSI at or below
input int    InpAtrPeriod         = 14;    // ATR period (entry timeframe)
input double InpMinAtr            = 0.80;  // Min ATR in price ($) to trade
input double InpMaxAtr            = 8.00;  // Max ATR in price ($) to trade
input int    InpCooldownBars      = 3;     // Entry-TF bars to wait after a basket closes

input group "=== Exits ==="
input double InpSlAtrMult         = 1.5;   // Stop loss = ATR x this
input double InpTpStartR          = 1.0;   // First position TP (R multiple)
input double InpTpStepR           = 0.5;   // Each further position TP adds this many R
input double InpBeTriggerR        = 0.8;   // Move SL to break-even after this many R
input double InpBeLockR           = 0.1;   // Break-even SL locks this many R of profit
input double InpTrailStartR       = 1.5;   // Start ATR trailing after this many R
input double InpTrailAtrMult      = 1.0;   // Trailing distance = ATR x this
input int    InpMaxBasketMinutes  = 90;    // Close basket after this many minutes (0 = off)

input group "=== Filters ==="
input double InpMaxSpread         = 0.40;  // Max spread in price ($)
input int    InpSessionStartHour  = 8;     // Session start (server hour)
input int    InpSessionEndHour    = 20;    // Session end (server hour)
input bool   InpTradeFriday       = true;  // Allow new baskets on Friday
input int    InpFridayFlatHour    = 20;    // Close everything on Friday from this hour (-1 = off)
input bool   InpUseNewsFilter     = true;  // Block around high-impact USD news (live only)
input int    InpNewsMinutesBefore = 15;    // Minutes before news to stop
input int    InpNewsMinutesAfter  = 15;    // Minutes after news to resume
input bool   InpFlatBeforeNews    = true;  // Close open baskets inside the news window

//+------------------------------------------------------------------+
//| Shared helpers                                                    |
//+------------------------------------------------------------------+
CTrade g_trade;
bool   g_hedging = true;

void Log(const string msg)
  {
   if(InpVerboseLog)
      Print("[GoldStack] ", msg);
  }

string GVName(const string key)
  {
   return "GS_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "_" +
          IntegerToString((long)InpMagic) + "_" + key;
  }

double GVGet(const string key, const double def)
  {
   string name = GVName(key);
   if(GlobalVariableCheck(name))
      return GlobalVariableGet(name);
   return def;
  }

void GVSet(const string key, const double value)
  {
   GlobalVariableSet(GVName(key), value);
  }

void GVDel(const string key)
  {
   string name = GVName(key);
   if(GlobalVariableCheck(name))
      GlobalVariableDel(name);
  }

double NormalizePrice(double price)
  {
   double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tickSize > 0.0)
      price = MathRound(price / tickSize) * tickSize;
   return NormalizeDouble(price, _Digits);
  }

int VolumeDigits(const double step)
  {
   int digits = 0;
   while(digits < 8)
     {
      double scaled = step * MathPow(10.0, digits);
      if(MathAbs(scaled - MathRound(scaled)) < 1e-8)
         break;
      digits++;
     }
   return digits;
  }

double NormalizeLots(double lots)
  {
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double minLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   if(step <= 0.0)
      step = 0.01;
   lots = MathFloor(lots / step + 1e-9) * step;
   if(lots < minLot)
      return 0.0;
   if(lots > maxLot)
      lots = maxLot;
   return NormalizeDouble(lots, VolumeDigits(step));
  }

datetime TradingDayKey(const datetime t)
  {
   long shifted = (long)t - (long)InpDayResetHour * 3600;
   return (datetime)(shifted - shifted % 86400);
  }

int CollectPositions(ulong &tickets[])
  {
   ArrayResize(tickets, 0);
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
         continue;
      if(PositionGetInteger(POSITION_MAGIC) != (long)InpMagic)
         continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol)
         continue;
      int n = ArraySize(tickets);
      ArrayResize(tickets, n + 1);
      tickets[n] = ticket;
     }
   return ArraySize(tickets);
  }

bool ClosePositionWithRetry(const ulong ticket)
  {
   for(int attempt = 0; attempt < 3; attempt++)
     {
      if(!PositionSelectByTicket(ticket))
         return true;
      if(g_trade.PositionClose(ticket, (ulong)InpSlippagePoints))
        {
         uint rc = g_trade.ResultRetcode();
         if(rc == TRADE_RETCODE_DONE || rc == TRADE_RETCODE_PLACED || rc == TRADE_RETCODE_DONE_PARTIAL)
            return true;
        }
      Log(StringFormat("Close #%I64u failed (retcode %u), retrying", ticket, g_trade.ResultRetcode()));
      Sleep(200);
     }
   return !PositionSelectByTicket(ticket);
  }

void CloseOurPositions(const string reason)
  {
   ulong tickets[];
   int n = CollectPositions(tickets);
   if(n == 0)
      return;
   Log("Closing " + IntegerToString(n) + " basket position(s): " + reason);
   for(int i = 0; i < n; i++)
      ClosePositionWithRetry(tickets[i]);
  }

void CloseEveryPosition(const string reason)
  {
   Log("Closing ALL account positions: " + reason);
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
         continue;
      ClosePositionWithRetry(ticket);
     }
  }

//+------------------------------------------------------------------+
//| Prop-firm drawdown guard                                          |
//+------------------------------------------------------------------+
class CPropGuard
  {
private:
   double   m_initial;
   double   m_dayRef;
   datetime m_dayKey;
   int      m_state;
   int      m_basketsToday;
   int      m_consecLosses;

   void Save()
     {
      GVSet("init", m_initial);
      GVSet("dayRef", m_dayRef);
      GVSet("dayKey", (double)m_dayKey);
      GVSet("state", (double)m_state);
      GVSet("baskets", (double)m_basketsToday);
      GVSet("consec", (double)m_consecLosses);
     }

   void RollDay()
     {
      datetime key = TradingDayKey(TimeCurrent());
      if(key == m_dayKey)
         return;
      double balance = AccountInfoDouble(ACCOUNT_BALANCE);
      double equity  = AccountInfoDouble(ACCOUNT_EQUITY);
      m_dayKey = key;
      m_dayRef = InpDayRefMaxBalEq ? MathMax(balance, equity) : balance;
      m_basketsToday = 0;
      m_consecLosses = 0;
      if(m_state == GUARD_DAILY_LOCK)
         m_state = GUARD_OK;
      Save();
      Log(StringFormat("New trading day. Reference %.2f, daily floor %.2f", m_dayRef, DailyFloor()));
     }

   void Breach(const int newState, const string reason)
     {
      m_state = newState;
      Save();
      if(InpGuardClosesAll)
         CloseEveryPosition(reason);
      else
         CloseOurPositions(reason);
      Alert("GoldStack guard: ", reason);
     }

public:
            CPropGuard() : m_initial(0.0), m_dayRef(0.0), m_dayKey(0), m_state(GUARD_OK),
                     m_basketsToday(0), m_consecLosses(0) {}

   void Init()
     {
      if(InpResetGuardState)
        {
         GVDel("init");
         GVDel("dayRef");
         GVDel("dayKey");
         GVDel("state");
         GVDel("baskets");
         GVDel("consec");
        }
      double balance = AccountInfoDouble(ACCOUNT_BALANCE);
      if(InpInitialBalance > 0.0)
         m_initial = InpInitialBalance;
      else
         m_initial = GVGet("init", balance);
      m_dayRef       = GVGet("dayRef", balance);
      m_dayKey       = (datetime)GVGet("dayKey", 0.0);
      m_state        = (int)GVGet("state", (double)GUARD_OK);
      m_basketsToday = (int)GVGet("baskets", 0.0);
      m_consecLosses = (int)GVGet("consec", 0.0);
      Save();
      RollDay();
      Log(StringFormat("Guard ready. Start balance %.2f, total floor %.2f, state %s",
                       m_initial, TotalFloor(), StateText()));
     }

   double DailyFloor() const
     {
      return m_dayRef - m_initial * (InpDailyLossPct - InpSafetyBufferPct) / 100.0;
     }

   double TotalFloor() const
     {
      return m_initial * (1.0 - (InpMaxLossPct - InpSafetyBufferPct) / 100.0);
     }

   double TargetLevel() const
     {
      if(InpProfitTargetPct <= 0.0)
         return 0.0;
      return m_initial * (1.0 + InpProfitTargetPct / 100.0);
     }

   double ActiveFloor() const
     {
      return MathMax(DailyFloor(), TotalFloor());
     }

   int Update()
     {
      RollDay();
      double equity = AccountInfoDouble(ACCOUNT_EQUITY);
      if(m_state != GUARD_TOTAL_LOCK && equity <= TotalFloor())
         Breach(GUARD_TOTAL_LOCK, StringFormat("Equity %.2f hit total-loss floor %.2f. Trading stopped permanently.", equity, TotalFloor()));
      else
         if(m_state == GUARD_OK && equity <= DailyFloor())
            Breach(GUARD_DAILY_LOCK, StringFormat("Equity %.2f hit daily-loss floor %.2f. Trading stopped until reset.", equity, DailyFloor()));
         else
            if(m_state == GUARD_OK && InpProfitTargetPct > 0.0 && equity >= TargetLevel())
               Breach(GUARD_TARGET_LOCK, StringFormat("Equity %.2f reached profit target %.2f. Trading stopped.", equity, TargetLevel()));

      if(m_state != GUARD_OK)
        {
         ulong tickets[];
         if(CollectPositions(tickets) > 0)
            CloseOurPositions("guard locked");
        }
      return m_state;
     }

   bool CanOpen() const
     {
      if(m_state != GUARD_OK)
         return false;
      if(m_basketsToday >= InpMaxBasketsPerDay)
         return false;
      if(m_consecLosses >= InpMaxConsecLosses)
         return false;
      return true;
     }

   double AllowedRisk(const double desired) const
     {
      double room = AccountInfoDouble(ACCOUNT_EQUITY) - ActiveFloor();
      if(room <= 0.0)
         return 0.0;
      return MathMin(desired, room * InpMaxRoomUsePct / 100.0);
     }

   void OnBasketOpened()
     {
      m_basketsToday++;
      Save();
     }

   void OnBasketClosed(const double pnl)
     {
      if(pnl < 0.0)
         m_consecLosses++;
      else
         m_consecLosses = 0;
      Save();
      if(m_consecLosses >= InpMaxConsecLosses)
         Log(StringFormat("%d losing baskets in a row. No new baskets until the day resets.", m_consecLosses));
     }

   string StateText() const
     {
      switch(m_state)
        {
         case GUARD_OK:
            return CanOpen() ? "ACTIVE" : "PAUSED (daily basket/loss-streak limit)";
         case GUARD_DAILY_LOCK:
            return "LOCKED - daily loss limit";
         case GUARD_TOTAL_LOCK:
            return "LOCKED - total loss limit";
         case GUARD_TARGET_LOCK:
            return "DONE - profit target reached";
        }
      return "UNKNOWN";
     }

   int BasketsToday() const { return m_basketsToday; }
   int ConsecLosses() const { return m_consecLosses; }
  };

//+------------------------------------------------------------------+
//| High-impact USD news filter (MT5 economic calendar)               |
//+------------------------------------------------------------------+
class CNewsFilter
  {
private:
   datetime m_events[];
   datetime m_lastRefresh;
   bool     m_available;

public:
            CNewsFilter() : m_lastRefresh(0), m_available(false) {}

   void Refresh()
     {
      if(!InpUseNewsFilter || MQLInfoInteger(MQL_TESTER))
        {
         m_available = false;
         return;
        }
      datetime now = TimeCurrent();
      if(m_lastRefresh > 0 && now - m_lastRefresh < 300)
         return;
      m_lastRefresh = now;

      MqlCalendarValue values[];
      ArrayResize(m_events, 0);
      if(!CalendarValueHistory(values, now - 3600, now + 2 * 86400, NULL, "USD"))
        {
         m_available = false;
         Log("Economic calendar unavailable, error " + IntegerToString(GetLastError()));
         return;
        }
      m_available = true;
      for(int i = 0; i < ArraySize(values); i++)
        {
         MqlCalendarEvent ev;
         if(!CalendarEventById(values[i].event_id, ev))
            continue;
         if(ev.importance != CALENDAR_IMPORTANCE_HIGH)
            continue;
         int k = ArraySize(m_events);
         ArrayResize(m_events, k + 1);
         m_events[k] = values[i].time;
        }
     }

   bool InWindow(const datetime now, datetime &eventTime) const
     {
      if(!m_available)
         return false;
      for(int i = 0; i < ArraySize(m_events); i++)
        {
         if(now >= m_events[i] - InpNewsMinutesBefore * 60 &&
            now <= m_events[i] + InpNewsMinutesAfter * 60)
           {
            eventTime = m_events[i];
            return true;
           }
        }
      return false;
     }

   string Status(const datetime now) const
     {
      if(!InpUseNewsFilter)
         return "off";
      if(!m_available)
         return MQLInfoInteger(MQL_TESTER) ? "n/a in tester" : "calendar unavailable";
      datetime ev = 0;
      if(InWindow(now, ev))
         return "BLOCKED (event " + TimeToString(ev, TIME_MINUTES) + ")";
      datetime next = 0;
      for(int i = 0; i < ArraySize(m_events); i++)
         if(m_events[i] > now && (next == 0 || m_events[i] < next))
            next = m_events[i];
      if(next == 0)
         return "clear";
      return "clear, next " + TimeToString(next, TIME_DATE | TIME_MINUTES);
     }
  };

//+------------------------------------------------------------------+
//| Signal engine: M15 trend bias + M5 EMA pullback reclaim           |
//+------------------------------------------------------------------+
class CSignal
  {
private:
   int      m_hFast;
   int      m_hSlow;
   int      m_hEma;
   int      m_hRsi;
   int      m_hAtr;
   datetime m_lastBar;

public:
            CSignal() : m_hFast(INVALID_HANDLE), m_hSlow(INVALID_HANDLE), m_hEma(INVALID_HANDLE),
                  m_hRsi(INVALID_HANDLE), m_hAtr(INVALID_HANDLE), m_lastBar(0) {}

   bool Init()
     {
      m_hFast = iMA(_Symbol, InpTrendTF, InpTrendFastEMA, 0, MODE_EMA, PRICE_CLOSE);
      m_hSlow = iMA(_Symbol, InpTrendTF, InpTrendSlowEMA, 0, MODE_EMA, PRICE_CLOSE);
      m_hEma  = iMA(_Symbol, InpEntryTF, InpEntryEMA, 0, MODE_EMA, PRICE_CLOSE);
      m_hRsi  = iRSI(_Symbol, InpEntryTF, InpRsiPeriod, PRICE_CLOSE);
      m_hAtr  = iATR(_Symbol, InpEntryTF, InpAtrPeriod);
      return m_hFast != INVALID_HANDLE && m_hSlow != INVALID_HANDLE && m_hEma != INVALID_HANDLE &&
             m_hRsi != INVALID_HANDLE && m_hAtr != INVALID_HANDLE;
     }

   void Release()
     {
      if(m_hFast != INVALID_HANDLE) IndicatorRelease(m_hFast);
      if(m_hSlow != INVALID_HANDLE) IndicatorRelease(m_hSlow);
      if(m_hEma  != INVALID_HANDLE) IndicatorRelease(m_hEma);
      if(m_hRsi  != INVALID_HANDLE) IndicatorRelease(m_hRsi);
      if(m_hAtr  != INVALID_HANDLE) IndicatorRelease(m_hAtr);
     }

   bool IsNewBar()
     {
      datetime t = iTime(_Symbol, InpEntryTF, 0);
      if(t == 0)
         return false;
      if(t != m_lastBar)
        {
         m_lastBar = t;
         return true;
        }
      return false;
     }

   double Atr() const
     {
      double buf[];
      if(CopyBuffer(m_hAtr, 0, 1, 1, buf) != 1)
         return 0.0;
      return buf[0];
     }

   int Bias() const
     {
      double fast[], slow[];
      ArraySetAsSeries(fast, true);
      ArraySetAsSeries(slow, true);
      if(CopyBuffer(m_hFast, 0, 1, 3, fast) != 3)
         return 0;
      if(CopyBuffer(m_hSlow, 0, 1, 1, slow) != 1)
         return 0;
      double close1 = iClose(_Symbol, InpTrendTF, 1);
      if(close1 <= 0.0)
         return 0;
      if(fast[0] > slow[0] && close1 > fast[0] && fast[0] > fast[2])
         return 1;
      if(fast[0] < slow[0] && close1 < fast[0] && fast[0] < fast[2])
         return -1;
      return 0;
     }

   int Entry() const
     {
      int bias = Bias();
      if(bias == 0)
         return 0;

      double ema[], rsi[];
      ArraySetAsSeries(ema, true);
      ArraySetAsSeries(rsi, true);
      if(CopyBuffer(m_hEma, 0, 1, 2, ema) != 2)
         return 0;
      if(CopyBuffer(m_hRsi, 0, 1, 1, rsi) != 1)
         return 0;

      double open1  = iOpen(_Symbol, InpEntryTF, 1);
      double close1 = iClose(_Symbol, InpEntryTF, 1);
      double low1   = iLow(_Symbol, InpEntryTF, 1);
      double high1  = iHigh(_Symbol, InpEntryTF, 1);
      double low2   = iLow(_Symbol, InpEntryTF, 2);
      double high2  = iHigh(_Symbol, InpEntryTF, 2);
      if(open1 <= 0.0 || close1 <= 0.0 || low2 <= 0.0)
         return 0;

      if(bias > 0)
        {
         bool pulledBack = (low1 <= ema[0]) || (low2 <= ema[1]);
         bool reclaimed  = (close1 > ema[0]) && (close1 > open1);
         if(pulledBack && reclaimed && rsi[0] >= InpRsiBuyMin)
            return 1;
        }
      else
        {
         bool pulledBack = (high1 >= ema[0]) || (high2 >= ema[1]);
         bool rejected   = (close1 < ema[0]) && (close1 < open1);
         if(pulledBack && rejected && rsi[0] <= InpRsiSellMax)
            return -1;
        }
      return 0;
     }
  };

//+------------------------------------------------------------------+
//| Basket state (persisted so restarts keep management intact)       |
//+------------------------------------------------------------------+
class CBasket
  {
public:
   bool     active;
   int      dir;
   double   risk;        // 1R = initial SL distance in price
   datetime openTime;
   double   openBalance;
   datetime lastClose;

            CBasket() : active(false), dir(0), risk(0.0), openTime(0), openBalance(0.0), lastClose(0) {}

   void Load()
     {
      active      = GVGet("bActive", 0.0) > 0.5;
      dir         = (int)GVGet("bDir", 0.0);
      risk        = GVGet("bRisk", 0.0);
      openTime    = (datetime)GVGet("bOpen", 0.0);
      openBalance = GVGet("bBal", 0.0);
      lastClose   = (datetime)GVGet("lastClose", 0.0);
     }

   void Save() const
     {
      GVSet("bActive", active ? 1.0 : 0.0);
      GVSet("bDir", (double)dir);
      GVSet("bRisk", risk);
      GVSet("bOpen", (double)openTime);
      GVSet("bBal", openBalance);
      GVSet("lastClose", (double)lastClose);
     }
  };

//+------------------------------------------------------------------+
//| Global engine objects                                             |
//+------------------------------------------------------------------+
CPropGuard  g_guard;
CNewsFilter g_news;
CSignal     g_signal;
CBasket     g_basket;
datetime    g_lastPanel = 0;

//+------------------------------------------------------------------+
//| Filters                                                           |
//+------------------------------------------------------------------+
bool InSession(const MqlDateTime &dt)
  {
   if(InpSessionStartHour == InpSessionEndHour)
      return true;
   if(InpSessionStartHour < InpSessionEndHour)
      return dt.hour >= InpSessionStartHour && dt.hour < InpSessionEndHour;
   return dt.hour >= InpSessionStartHour || dt.hour < InpSessionEndHour;
  }

bool FridayFlatTime(const MqlDateTime &dt)
  {
   if(InpFridayFlatHour < 0)
      return false;
   return dt.day_of_week == 5 && dt.hour >= InpFridayFlatHour;
  }

double CurrentSpread()
  {
   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick))
      return 999999.0;
   return tick.ask - tick.bid;
  }

string EntryBlockReason(const double atr)
  {
   datetime now = TimeCurrent();
   MqlDateTime dt;
   TimeToStruct(now, dt);
   if(dt.day_of_week == 0 || dt.day_of_week == 6)
      return "weekend";
   if(dt.day_of_week == 5 && !InpTradeFriday)
      return "Friday disabled";
   if(FridayFlatTime(dt))
      return "Friday flat time";
   if(!InSession(dt))
      return "outside session";
   if(CurrentSpread() > InpMaxSpread)
      return "spread too wide";
   if(atr < InpMinAtr)
      return "volatility too low";
   if(atr > InpMaxAtr)
      return "volatility too high";
   datetime ev = 0;
   if(g_news.InWindow(now, ev))
      return "news window";
   if(g_basket.lastClose > 0 && now - g_basket.lastClose < (long)InpCooldownBars * PeriodSeconds(InpEntryTF))
      return "cooldown";
   if(!g_guard.CanOpen())
      return "guard";
   return "";
  }

//+------------------------------------------------------------------+
//| Basket opening                                                    |
//+------------------------------------------------------------------+
bool OpenBasket(const int dir, const double atr)
  {
   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick))
      return false;

   double price  = dir > 0 ? tick.ask : tick.bid;
   double spread = tick.ask - tick.bid;
   double minStop = (double)(SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) + 5) * _Point + spread;
   double slDist  = MathMax(atr * InpSlAtrMult, minStop);
   double sl      = dir > 0 ? price - slDist : price + slDist;

   double balance   = AccountInfoDouble(ACCOUNT_BALANCE);
   double riskMoney = g_guard.AllowedRisk(balance * InpRiskPerBasketPct / 100.0);
   if(riskMoney <= 0.0)
     {
      Log("No risk room left today.");
      return false;
     }

   ENUM_ORDER_TYPE type = dir > 0 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   double slProfit = 0.0;
   if(!OrderCalcProfit(type, _Symbol, 1.0, price, sl, slProfit))
     {
      Log("OrderCalcProfit failed, error " + IntegerToString(GetLastError()));
      return false;
     }
   double lossPerLot = (MathAbs(slProfit) + InpCommissionPerLot) * 1.05;
   if(lossPerLot <= 0.0)
      return false;

   double totalLots = MathMin(riskMoney / lossPerLot, InpMaxBasketLots);

   double marginPerLot = 0.0;
   if(OrderCalcMargin(type, _Symbol, 1.0, price, marginPerLot) && marginPerLot > 0.0)
     {
      double maxByMargin = AccountInfoDouble(ACCOUNT_MARGIN_FREE) * InpMaxMarginUsePct / 100.0 / marginPerLot;
      totalLots = MathMin(totalLots, maxByMargin);
     }

   int stack = g_hedging ? MathMax(1, MathMin(InpStackCount, 10)) : 1;
   double lotEach = NormalizeLots(totalLots / stack);
   while(stack > 1 && lotEach <= 0.0)
     {
      stack--;
      lotEach = NormalizeLots(totalLots / stack);
     }
   if(lotEach <= 0.0)
     {
      Log(StringFormat("Basket skipped: %.3f lots allowed is below broker minimum %.2f",
                       totalLots, SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN)));
      return false;
     }

   double balanceBefore = AccountInfoDouble(ACCOUNT_BALANCE);
   int opened = 0;
   for(int i = 0; i < stack; i++)
     {
      double tpR = InpTpStartR + InpTpStepR * i;
      double tp  = dir > 0 ? price + slDist * tpR : price - slDist * tpR;
      string comment = "GoldStack " + IntegerToString(i + 1) + "/" + IntegerToString(stack);
      bool sent = dir > 0
                  ? g_trade.Buy(lotEach, _Symbol, 0.0, NormalizePrice(sl), NormalizePrice(tp), comment)
                  : g_trade.Sell(lotEach, _Symbol, 0.0, NormalizePrice(sl), NormalizePrice(tp), comment);
      uint rc = g_trade.ResultRetcode();
      if(sent && (rc == TRADE_RETCODE_DONE || rc == TRADE_RETCODE_PLACED))
         opened++;
      else
         Log(StringFormat("Order %d failed: retcode %u (%s)", i + 1, rc, g_trade.ResultRetcodeDescription()));
     }

   if(opened == 0)
      return false;

   g_basket.active      = true;
   g_basket.dir         = dir;
   g_basket.risk        = slDist;
   g_basket.openTime    = TimeCurrent();
   g_basket.openBalance = balanceBefore;
   g_basket.Save();
   g_guard.OnBasketOpened();

   Log(StringFormat("%s basket opened: %d x %.2f lots @ %.3f, SL %.3f (1R = %.3f, risk ~%.2f)",
                    dir > 0 ? "BUY" : "SELL", opened, lotEach, price, sl, slDist,
                    lotEach * opened * lossPerLot));
   return true;
  }

//+------------------------------------------------------------------+
//| Basket management                                                 |
//+------------------------------------------------------------------+
bool SafeModify(const ulong ticket, double newSL, const double tp, const int dir)
  {
   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick))
      return false;
   double minDist = (double)(SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) +
                             SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL) + 2) * _Point;
   if(dir > 0 && newSL > tick.bid - minDist)
      return false;
   if(dir < 0 && newSL < tick.ask + minDist)
      return false;
   newSL = NormalizePrice(newSL);
   return g_trade.PositionModify(ticket, newSL, tp);
  }

void FinalizeBasket()
  {
   double pnl = AccountInfoDouble(ACCOUNT_BALANCE) - g_basket.openBalance;
   g_guard.OnBasketClosed(pnl);
   g_basket.active    = false;
   g_basket.lastClose = TimeCurrent();
   g_basket.Save();
   Log(StringFormat("Basket closed. Result %.2f", pnl));
  }

void AdoptExistingPositions(const ulong &tickets[], const double atr)
  {
   if(!PositionSelectByTicket(tickets[0]))
      return;
   long   type = PositionGetInteger(POSITION_TYPE);
   double open = PositionGetDouble(POSITION_PRICE_OPEN);
   double sl   = PositionGetDouble(POSITION_SL);
   g_basket.active      = true;
   g_basket.dir         = type == POSITION_TYPE_BUY ? 1 : -1;
   g_basket.risk        = sl > 0.0 ? MathAbs(open - sl) : atr * InpSlAtrMult;
   g_basket.openTime    = (datetime)PositionGetInteger(POSITION_TIME);
   g_basket.openBalance = AccountInfoDouble(ACCOUNT_BALANCE);
   g_basket.Save();
   Log("Adopted existing basket positions after restart.");
  }

void ManageBasket(const double atr)
  {
   ulong tickets[];
   int n = CollectPositions(tickets);
   if(n == 0)
     {
      if(g_basket.active)
         FinalizeBasket();
      return;
     }
   if(!g_basket.active || g_basket.risk <= 0.0)
      AdoptExistingPositions(tickets, atr);

   if(InpMaxBasketMinutes > 0 && TimeCurrent() - g_basket.openTime >= (long)InpMaxBasketMinutes * 60)
     {
      CloseOurPositions("basket time limit");
      return;
     }

   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick))
      return;
   double R = g_basket.risk;
   double minStep = MathMax(SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE) * 5.0, R * 0.05);

   for(int i = 0; i < n; i++)
     {
      ulong ticket = tickets[i];
      if(!PositionSelectByTicket(ticket))
         continue;
      int    dir  = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1;
      double open = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl   = PositionGetDouble(POSITION_SL);
      double tp   = PositionGetDouble(POSITION_TP);
      double progress = dir > 0 ? tick.bid - open : open - tick.ask;

      double target = sl;
      if(progress >= InpBeTriggerR * R)
        {
         double be = dir > 0 ? open + InpBeLockR * R : open - InpBeLockR * R;
         if(dir > 0)
            target = MathMax(target, be);
         else
            target = (target <= 0.0) ? be : MathMin(target, be);
        }
      if(progress >= InpTrailStartR * R && atr > 0.0)
        {
         double trail = dir > 0 ? tick.bid - atr * InpTrailAtrMult : tick.ask + atr * InpTrailAtrMult;
         if(dir > 0)
            target = MathMax(target, trail);
         else
            target = (target <= 0.0) ? trail : MathMin(target, trail);
        }

      bool improves = (sl <= 0.0) ? (target > 0.0)
                      : (dir > 0 ? target - sl >= minStep : sl - target >= minStep);
      if(improves)
         SafeModify(ticket, target, tp, dir);
     }
  }

//+------------------------------------------------------------------+
//| On-chart status panel                                             |
//+------------------------------------------------------------------+
void DrawPanel(const double atr, const string blockReason)
  {
   datetime now = TimeCurrent();
   if(now == g_lastPanel)
      return;
   g_lastPanel = now;
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   ulong tickets[];
   int open = CollectPositions(tickets);
   string text = "GoldStack Prop EA  |  " + _Symbol + "\n";
   text += "Guard: " + g_guard.StateText() + "\n";
   text += StringFormat("Equity %.2f   Balance %.2f\n", equity, AccountInfoDouble(ACCOUNT_BALANCE));
   text += StringFormat("Daily floor %.2f   (room %.2f)\n", g_guard.DailyFloor(), equity - g_guard.DailyFloor());
   text += StringFormat("Total floor %.2f   (room %.2f)\n", g_guard.TotalFloor(), equity - g_guard.TotalFloor());
   if(InpProfitTargetPct > 0.0)
      text += StringFormat("Target %.2f   (to go %.2f)\n", g_guard.TargetLevel(), g_guard.TargetLevel() - equity);
   text += StringFormat("Baskets today %d/%d   Loss streak %d/%d\n",
                        g_guard.BasketsToday(), InpMaxBasketsPerDay, g_guard.ConsecLosses(), InpMaxConsecLosses);
   text += StringFormat("Open positions %d   Spread %.2f   ATR %.2f\n", open, CurrentSpread(), atr);
   text += "News: " + g_news.Status(now) + "\n";
   text += "Entry: " + (blockReason == "" ? "watching for signal" : "blocked - " + blockReason);
   Comment(text);
  }

//+------------------------------------------------------------------+
//| Core processing                                                   |
//+------------------------------------------------------------------+
void Process()
  {
   g_guard.Update();
   g_news.Refresh();

   double atr = g_signal.Atr();
   datetime now = TimeCurrent();
   MqlDateTime dt;
   TimeToStruct(now, dt);

   ulong tickets[];
   if(CollectPositions(tickets) > 0)
     {
      if(FridayFlatTime(dt))
         CloseOurPositions("Friday flat time");
      datetime ev = 0;
      if(InpFlatBeforeNews && g_news.InWindow(now, ev))
         CloseOurPositions("high-impact news at " + TimeToString(ev, TIME_MINUTES));
     }

   ManageBasket(atr);

   string blockReason = EntryBlockReason(atr);
   if(g_signal.IsNewBar() && blockReason == "" && CollectPositions(tickets) == 0)
     {
      int dir = g_signal.Entry();
      if(dir != 0)
         OpenBasket(dir, atr);
     }

   DrawPanel(atr, blockReason);
  }

//+------------------------------------------------------------------+
//| Expert lifecycle                                                  |
//+------------------------------------------------------------------+
int OnInit()
  {
   if(!InpAllowNonGold && StringFind(_Symbol, "XAU") < 0 && StringFind(_Symbol, "GOLD") < 0)
     {
      Alert("GoldStack: attach this EA to an XAUUSD / GOLD chart.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(InpDailyLossPct <= InpSafetyBufferPct || InpMaxLossPct <= InpSafetyBufferPct)
     {
      Alert("GoldStack: safety buffer must be smaller than the firm loss limits.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(InpRiskPerBasketPct <= 0.0 || InpSlAtrMult <= 0.0 || InpTpStartR <= 0.0 || InpStackCount < 1)
     {
      Alert("GoldStack: risk, stop, take-profit and stack inputs must be positive.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(InpTrendFastEMA >= InpTrendSlowEMA)
     {
      Alert("GoldStack: trend fast EMA must be shorter than slow EMA.");
      return INIT_PARAMETERS_INCORRECT;
     }

   g_hedging = (ENUM_ACCOUNT_MARGIN_MODE)AccountInfoInteger(ACCOUNT_MARGIN_MODE) == ACCOUNT_MARGIN_MODE_RETAIL_HEDGING;
   if(!g_hedging)
      Log("Netting account detected: stacking disabled, one position per basket.");

   g_trade.SetExpertMagicNumber(InpMagic);
   g_trade.SetDeviationInPoints((ulong)InpSlippagePoints);
   g_trade.SetTypeFillingBySymbol(_Symbol);
   g_trade.LogLevel(LOG_LEVEL_ERRORS);

   if(!g_signal.Init())
     {
      Alert("GoldStack: failed to create indicator handles.");
      return INIT_FAILED;
     }

   g_guard.Init();
   g_basket.Load();
   g_news.Refresh();
   EventSetTimer(1);
   Log("Initialized on " + _Symbol + (g_hedging ? " (hedging)" : " (netting)"));
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   g_signal.Release();
   Comment("");
  }

void OnTick()
  {
   Process();
  }

void OnTimer()
  {
   g_guard.Update();
  }
//+------------------------------------------------------------------+
