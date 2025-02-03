import Error from "./Error";

const Redirect = ({ error, children }) => {
  const params = new Proxy(new URLSearchParams(window.location.search), {
    get: (searchParams, prop) => searchParams.get(prop),
  });

  const handleDownloadICS = (event) => {
    // Format dates for iCalendar (YYYYMMDDTHHMMSSZ)
    const formatDate = (date) => date.replace(/[-:]/g, "").split(".")[0] + "Z";

    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
SUMMARY:${event.title}
DESCRIPTION:
LOCATION:${event.location}
DTSTART:${formatDate(event.start)}
DTEND:${formatDate(event.end)}
END:VEVENT
END:VCALENDAR`;

    // Create a Blob and download it
    const blob = new Blob([icsContent], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "event.ics";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (params.title) {
    handleDownloadICS(params)
  }
  if (error) {
    return <Error error={error} />;
  }
  return children;
};

export default Redirect;
