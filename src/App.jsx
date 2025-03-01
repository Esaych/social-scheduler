import { useState, useEffect, useMemo, useRef } from "react";
import {
  format,
  isSameDay,
  add,
  differenceInMinutes,
  areIntervalsOverlapping,
  startOfDay,
  sub,
} from "date-fns";
import ical from "ical";
import { rrulestr } from "rrule";
import Redirect from "./components/Redirect";
import FilterSection, { DayFilter, TopicsFilter } from "./components/filters";
import BlockSection from "./components/block";
import ConfirmDialog from "./components/ConfirmDialog";
import config from "./config";

const weeks = 3;
const dayInMs = 86400000;

const rules = {
  lunch: (b) => b.summary?.includes("Lunch"),
  dinner: (b) => b.summary?.includes("Dinner"),
  work: (b) => b.summary?.includes("Work") && b.date.getHours() < 17,
  afternoon: (b) => format(b.date, "BBBB").endsWith("afternoon"),
  evening: (b) => format(b.date, "BBBB").endsWith("evening"),
};

const App = () => {
  const cal = useCalendar(config.cal);
  const plans = config.plans.map((plan) => useCalendar(plan));

  const [day, setDay] = useState("");
  const [block, setBlock] = useState("");
  const [topics, setTopics] = useState([]);

  const eventHeaderScrolls = useRef(new Map());
  const dayScrolls = useRef(new Map());
  const scrollToDay = (day) => {
    if (enabledDates.find((d) => isSameDay(d.date, day))) setDay(day);
    dayScrolls.current.get(day.toDateString())?.scrollIntoView({
      behavior: "smooth",
    });
  };

  const blocks = useBlocks(
    cal?.data,
    plans?.map((p) => p?.data),
    topics
  );
  const [dates, enabledDates] = useDates(blocks);

  useEffect(() => {
    if (
      enabledDates.length > 0 &&
      (day === "" || !enabledDates.find((d) => isSameDay(d.date, day)))
    ) {
      setDay(enabledDates[0].date);
    }
  }, [enabledDates, day]);

  return (
    <Redirect error={cal?.error}>
      <div className="fixed top-0 right-0 left-0 bottom-0 flex flex-col sm:gap-4 overflow-hidden">
        <div className="bg-slate-700 w-full py-3">
          <h1 className="font-semibold text-xl sm:text-2xl text-center">
            Schedule with {config.name}
          </h1>
        </div>
        <div className="max-w-xl mx-auto w-full min-h-0 flex flex-col sm:gap-4">
          <div className="bg-slate-800 items-center justify-between px-4 pt-4">
            <FilterSection>
              <TopicsFilter topics={topics} setTopics={setTopics} />
              <DayFilter
                value={day}
                onChange={(e) => {
                  setDay(e);
                  eventHeaderScrolls.current
                    .get(e.toDateString())
                    ?.scrollIntoView({
                      behavior: "smooth",
                    });
                }}
                dates={dates}
                disabled={(d) => !enabledDates.includes(d)}
                scrolls={dayScrolls}
              />
            </FilterSection>
          </div>
          <div className="sm:mx-4 border-t-4 border-slate-700" />
          <BlockSection
            day={day}
            value={block}
            onChange={setBlock}
            blocks={blocks.sort((a, b) => a.date - b.date)}
            scrolls={eventHeaderScrolls}
            scrollToDay={scrollToDay}
          />
        </div>
      </div>
      <ConfirmDialog block={block} setBlock={setBlock} />
    </Redirect>
  );
};

const useBlocks = (data, plansData, topics) => {
  const blocks = useMemo(() => {
    if (!data || plansData.includes(undefined)) return [];

    const now = new Date();
    const yesterday = sub(new Date(), {
      minutes: now.getTimezoneOffset(),
    });
    const then = add(now, { weeks, days: -1 });
    const blocks = [];
    Object.values(data)
      .filter((event) => event.type === "VEVENT")
      .forEach((event) => {
        if (event.rrule) {
          rrulestr(event.rrule.toString())
            .between(yesterday, then) // generates starting yesterday due to timezone bug
            .forEach((occurrence) => {
              // RRule has a bug with timezones and starts occurrences based on UTC time rather than local timezone
              // This pushes the occurrence by 1 day if the timezone offset causes the event to appear on the incorrect day
              const possiblyNextDay = add(occurrence, {
                minutes: occurrence.getTimezoneOffset(),
              });
              const adjustedDate =
                possiblyNextDay.getDate() !== occurrence.getDate()
                  ? add(occurrence, {
                      days: possiblyNextDay > occurrence ? 1 : -1,
                    })
                  : occurrence;
              if (adjustedDate > now && adjustedDate < then)
                blocks.push({
                  ...event,
                  date: adjustedDate,
                  endDate: add(adjustedDate, {
                    minutes: differenceInMinutes(event.end, event.start),
                  }),
                  id: event.uid + adjustedDate.toString(),
                });
            });
        } else if (then > event.start && event.start > now) {
          blocks.push({
            ...event,
            date: event.start,
            endDate: event.end,
            id: event.uid,
          });
        }
      });

    const planBlocks = [];
    plansData
      .flatMap((p) => Object.values(p))
      .filter((event) => (event.type = "VEVENT"))
      //Filter to just <1 day long events, exception for all day events in all caps on the public cal
      .filter((event) => event.end - event.start < dayInMs || /^[A-Z\s]+$/.test(event.summary)) 
      .forEach((event) => {
        if (event.recurrences) {
          Object.entries(event.recurrences).forEach((val) => {
            const occurrence = val[1].start;
            if (then > occurrence && occurrence > now) {
              planBlocks.push({
                ...event,
                date: occurrence,
                endDate: add(occurrence, {
                  minutes: differenceInMinutes(event.end, event.start),
                }),
                id: event.uid + occurrence.toString(),
              });
            }
          });
        }
        if (then > event.start && event.start > now) {
          planBlocks.push({
            ...event,
            date: event.start,
            endDate: event.end,
            id: event.uid,
          });
        }
      });

    return blocks.map((b) => {
      const overlaps = planBlocks.filter((p) =>
        areIntervalsOverlapping(
          { start: b.date, end: b.endDate },
          { start: p.date, end: p.endDate }
        )
      );
      b.overlaps = overlaps.map((o) => ({
        id: o.id,
        date: o.date,
        blocks: [b.summary],
        name: o.summary,
        private: o.transparency === undefined,
      }));
      return b;
    });
  }, [data, plansData]);


  const filteredBlocks = useMemo(() => {
    if (!blocks.length) return [];

    return blocks.filter((b) => {
      return topics.length === 0
        ? true
        : topics.reduce((p, t) => (p ? p : rules[t](b)), false);
    });
  }, [blocks, topics]);

  return filteredBlocks;
};

const useDates = (blocks) => {
  const [dates, enabledDates] = useMemo(() => {
    const today = startOfDay(new Date());
    const dates = Array.from({ length: weeks * 7 }, (_, i) => {
      const nextDate = add(today, { days: i });
      return {
        date: nextDate,
        label:
          nextDate.getTime() === today.getTime()
            ? "Today"
            : nextDate.getTime() === today.getTime() + 60 * 60 * 24000
            ? "Tmrw"
            : format(nextDate, "EEE"),
      };
    });
    const enabledDates = dates.filter(
      (d) => blocks.filter((b) => isSameDay(b.date, d.date)).length !== 0
    );
    return [dates, enabledDates];
  }, [blocks]);

  return [dates, enabledDates];
};

const useCalendar = (url) => {
  const [cal, setCal] = useState();

  useEffect(() => {
    fetch("https://corsproxy.io/?url=" + url)
      .then((resp) => {
        if (resp.ok) {
          resp.text().then((text) => setCal({ data: ical.parseICS(text) }));
        } else {
          resp.text().then((text) => setCal({ error: text }));
        }
      })
      .catch((error) => {
        setCal({ error: error.message });
      });
  }, [url]);

  return cal;
};

export default App;
