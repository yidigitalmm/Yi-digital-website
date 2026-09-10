import { useLayoutEffect, useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { type Locale } from "./content";
import { PageRoutes } from "./pages";
import { Footer, Header, ScrollReset, type Theme } from "./ui";

export default function App() {
  const [locale, setLocale] = useState<Locale>("en");
  const [theme, setTheme] = useState<Theme>("light");

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useLayoutEffect(() => {
    document.documentElement.lang = locale === "my" ? "my" : "en";
  }, [locale]);

  return (
    <BrowserRouter>
      <ScrollReset />
      <Header
        locale={locale}
        theme={theme}
        onLocale={() => setLocale((value) => value === "en" ? "my" : "en")}
        onTheme={() => setTheme((value) => value === "light" ? "dark" : "light")}
      />
      <PageRoutes locale={locale} />
      <Footer locale={locale} />
    </BrowserRouter>
  );
}
