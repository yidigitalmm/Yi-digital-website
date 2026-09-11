import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { getWork } from "./cms/content";

describe("Yi Digital", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("opens keyboard navigation and returns focus to the menu button on Escape", async () => {
    render(<App />);
    const toggle = screen.getByRole("button", { name: "Toggle navigation" });
    const navigation = screen.getByRole("navigation", { name: "Primary navigation" });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", navigation.id);
    expect(within(navigation).getByRole("link", { name: "Home" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
  });

  it("dismisses navigation after outside clicks, logo clicks, and route selection", async () => {
    render(<App />);
    const toggle = screen.getByRole("button", { name: "Toggle navigation" });
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole("heading", { level: 1 }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    await userEvent.click(within(screen.getByRole("banner")).getByRole("link", { name: "Yi Digital home" }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    await userEvent.click(within(screen.getByRole("navigation", { name: "Primary navigation" })).getByRole("link", { name: "Services" }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(window.location.pathname).toBe("/services");
  });

  it.each([
    ["/", "Website Design in Myanmar"],
    ["/services", "Website Design Packages & Prices in Myanmar"],
    ["/our-work", "Previous Work"],
    ["/journal", "Journal"],
    ["/contact", "Contact & Consultation"],
    ["/motion", "Animation & Interactive Experiences"],
  ])("sets metadata and one main heading for %s", async (path, title) => {
    window.history.pushState({}, "", path);
    render(<App />);
    expect(document.title).toBe(`${title} | Yi Digital`);
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute("content")).toBeTruthy();
    expect(await screen.findAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it.each(["/missing-page", "/journal/missing-article"])("keeps missing URL %s and offers a way home", async (path) => {
    window.history.pushState({}, "", path);
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: "Page not found." })).toBeInTheDocument();
    expect(window.location.pathname).toBe(path);
    expect(document.title).toBe("Page not found | Yi Digital");
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await userEvent.click(screen.getByRole("link", { name: "Back to home" }));
    expect(window.location.pathname).toBe("/");
    expect(document.title).toBe("Website Design in Myanmar | Yi Digital");
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
  });

  it("uses article metadata and updates it with the language", async () => {
    window.history.pushState({}, "", "/journal/why-online-presence-matters");
    render(<App />);
    const englishTitle = document.title;
    const englishDescription = document.head.querySelector('meta[name="description"]')?.getAttribute("content");
    expect(englishTitle).toBe("Why online presence matters for local businesses | Yi Digital");
    expect(document.head.querySelector('meta[property="og:type"]')).toHaveAttribute("content", "article");
    await userEvent.click(screen.getByRole("button", { name: /switch to Myanmar language/i }));
    expect(document.title).not.toBe(englishTitle);
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute("content")).not.toBe(englishDescription);
  });

  it("renders the selected homepage direction", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /can customers find you/i })).toBeInTheDocument();
    expect(screen.getByText(/from invisible to unmistakable/i)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /search results stack up/i })).toBeInTheDocument();
    expect(screen.getByText("Businesses Near Me")).toBeInTheDocument();
  });

  it("keeps the six primary routes", () => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: /primary navigation/i });
    expect(within(nav).getByRole("link", { name: /^home$/i })).toHaveAttribute("href", "/");
    expect(within(nav).getByRole("link", { name: /^services$/i })).toHaveAttribute("href", "/services");
    expect(within(nav).getByRole("link", { name: /^animation$/i })).toHaveAttribute("href", "/motion");
    expect(within(nav).getByRole("link", { name: /^journal$/i })).toHaveAttribute("href", "/journal");
    expect(within(nav).getByRole("link", { name: /our work/i })).toHaveAttribute("href", "/our-work");
    expect(within(nav).getByRole("link", { name: /^contact$/i })).toHaveAttribute("href", "/contact");
  });

  it("renders the interactive motion showcase", () => {
    window.history.pushState({}, "", "/motion");
    render(<App />);
    expect(screen.getByRole("heading", { name: /reveal the human behind the machine/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /movement with a reason/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pause animations/i })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /motion animation/i })).toBeInTheDocument();
    expect(screen.queryByText(/magnetic call to action/i)).not.toBeInTheDocument();
  });

  it("switches between motion animation examples", async () => {
    window.history.pushState({}, "", "/motion");
    render(<App />);

    expect(screen.getByRole("heading", { name: /motion animation/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /show how it all comes together/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /surprise reveal/i }));
    expect(document.querySelector(".start-end-media source")?.getAttribute("src")).toBe("/videos/start-end/blind-box-reveal-transparent.webm");
    await userEvent.click(screen.getByRole("tab", { name: /transformation/i }));

    expect(screen.getByRole("heading", { name: /make the change easy to see/i })).toBeInTheDocument();
    expect(document.querySelector(".start-end-media source")?.getAttribute("src")).toBe("/videos/start-end/kitchen-build.mp4");
    expect(screen.getByRole("tab", { name: /transformation/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("Case study")).not.toBeInTheDocument();
    expect(screen.queryByText(/03 \/ 03/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/view the project/i)).not.toBeInTheDocument();
  });

  it("switches to the matched dark theme", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /switch to dark mode/i }));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("switches the complete homepage to Myanmar language", async () => {
    render(<App />);
    const languageSwitcher = screen.getByRole("button", { name: /switch to Myanmar language/i });
    expect(languageSwitcher).toHaveTextContent("မြန်မာ");
    await userEvent.click(languageSwitcher);

    expect(document.documentElement.lang).toBe("my");
    expect(screen.getByText("EN", { selector: "button" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "သင့်လုပ်ငန်းကို ရှာတွေ့နိုင်ပါသလား?" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ရှာတွေ့နိုင်စေခြင်း" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "သင့်လုပ်ငန်းအတွက် လိုအပ်သမျှ" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "လုပ်ငန်းရှင်များအတွက် လက်တွေ့အသုံးဝင်သော အကြံပြုချက်များ။" })).toBeInTheDocument();
    expect(screen.getByText("© ၂၀၂၆ Yi Digital။ မူပိုင်ခွင့်အားလုံး ရယူထားသည်။")).toBeInTheDocument();
  });

  it("translates every primary page and full journal articles", async () => {
    const cases = [
      ["/services", "အောင်မြင်သောလုပ်ငန်းတစ်ခု၏နောက် ကွယ်တွင်ဘာတွေရှိသလဲ?"],
      ["/our-work", "ဖောက်သည်တစ်ဦးချင်း ရွေးချယ်ခဲ့သည့်အရာနှင့် ရရှိလာသော အကျိုးကျေးဇူး။"],
      ["/journal", "အွန်လိုင်းပုံရိပ်သည် လုပ်ငန်း၏ အခြေခံအဆောက်အအုံဖြစ်သည်။"],
      ["/contact", "သင့်လုပ်ငန်းအကြောင်း ပြောပြပါ။"],
      ["/journal/complete-google-business-profile", "ပြည့်စုံသော Google လုပ်ငန်းပရိုဖိုင်၏ တိတ်ဆိတ်သောစွမ်းအား။"],
    ] as const;

    for (const [path, heading] of cases) {
      window.history.pushState({}, "", path);
      const { unmount } = render(<App />);
      await userEvent.click(screen.getByRole("button", { name: /switch to Myanmar language/i }));
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
      unmount();
    }
  });

  it("uses two taps to open a perspective card on touch devices", async () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query === "(hover: none) and (pointer: coarse)",
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });

    const { unmount } = render(<App />);
    const cardLink = screen.getByRole("link", { name: /view customizable/i });

    await userEvent.click(cardLink);
    expect(cardLink.closest("article")).toHaveClass("is-active");
    expect(window.location.pathname).toBe("/");

    await userEvent.click(cardLink);
    expect(window.location.pathname).toBe("/our-work");

    unmount();
    Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
  });

  it("shows the package and add-ons selected for previous projects", () => {
    const projects = getWork("en");
    window.history.pushState({}, "", "/our-work");
    render(<App />);

    expect(screen.getByRole("heading", { name: "Taunggyi Hotel" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "The Peak" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sein Htan Pin" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Customizable" })).toBeInTheDocument();
    const projectCases = screen.getAllByRole("article");
    expect(within(projectCases[0]).getByRole("heading", { name: "Customizable" })).toBeInTheDocument();
    expect(within(projectCases[1]).getByRole("heading", { name: "Sein Htan Pin" })).toBeInTheDocument();
    expect(within(projectCases[1]).getByRole("img", { name: /sein htan pin scrolling website preview/i })).toHaveAttribute("src", projects[1].scrollImage ?? projects[1].image);
    expect(within(projectCases[1]).getByRole("link", { name: /visit live website/i })).toHaveAttribute("href", "https://seinhtanpin.com/");
    expect(within(projectCases[2]).getByRole("heading", { name: "The Peak" })).toBeInTheDocument();
    expect(within(projectCases[2]).getByRole("img", { name: /the peak scrolling website preview/i })).toHaveAttribute("src", projects[2].scrollImage ?? projects[2].image);
    expect(within(projectCases[2]).getByRole("link", { name: /visit live website/i })).toHaveAttribute("href", "https://taunggyihotel-thepeak-website.yetunkhine.workers.dev/thepeak/");
    expect(within(projectCases[3]).getByRole("heading", { name: "Taunggyi Hotel" })).toBeInTheDocument();
    expect(within(projectCases[3]).getByRole("img", { name: /taunggyi hotel scrolling website preview/i })).toHaveAttribute("src", projects[3].scrollImage ?? projects[3].image);
    expect(within(projectCases[3]).getByRole("link", { name: /visit live website/i })).toHaveAttribute("href", "https://taunggyihotel-thepeak-website.yetunkhine.workers.dev/");
    expect(screen.getAllByText("Package selected")).toHaveLength(4);
    expect(screen.getAllByText("Advanced")).toHaveLength(1);
    expect(screen.getByText("Hybrid")).toBeInTheDocument();
    expect(screen.getAllByText("Basic Online")).toHaveLength(2);
    expect(screen.getAllByText("Website content planning")).toHaveLength(3);
  });

  it("renders the package comparison", () => {
    window.history.pushState({}, "", "/services");
    render(<App />);
    expect(screen.getByRole("heading", { name: /what’s behind a successful business/i })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /package comparison/i })).toBeInTheDocument();
    expect(screen.getAllByText("Hybrid").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1,000,000 MMK").length).toBeGreaterThan(0);
    expect(screen.getByText("Website content planning")).toBeInTheDocument();
    expect(screen.getByText("200,000 MMK")).toBeInTheDocument();
  });

  it("carries a selected package into the contact form", async () => {
    window.history.pushState({}, "", "/services");
    render(<App />);

    await userEvent.click(screen.getAllByRole("link", { name: /select this package/i })[2]);

    expect(window.location.pathname).toBe("/contact");
    expect(window.location.search).toBe("?package=Advanced");
    expect(screen.getByRole("textbox", { name: /^email$/i })).toHaveAttribute("type", "email");
    expect(screen.getByRole("textbox", { name: /phone number/i })).toHaveAttribute("type", "tel");
    expect(screen.queryByRole("combobox", { name: /preferred contact method/i })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /package interest/i })).toHaveValue("Advanced");
  });

  it("renders the structured Burmese package content", async () => {
    window.history.pushState({}, "", "/services");
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /switch to Myanmar language/i }));

    expect(screen.getByText("ကျွမ်းကျင်သော ဝဘ်ဆိုက်လိုအပ်ပြီး အကြောင်းအရာ မကြာခဏ မပြောင်းသည့်လုပ်ငန်းများအတွက်။", { selector: ".package-card p" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /စတင်ဈေးနှုန်း 600,000 MMK 1,000,000 MMK 1,500,000 MMK 3,000,000 MMK မှစ၍/i })).toBeInTheDocument();
    expect(screen.getByText("ဖောက်သည်ပေးရမည့် အကြောင်းအရာ")).toBeInTheDocument();
  });

  it("uses each page's translation for important section headings", async () => {
    const cases = [
      ["/services", "အတူတကွ လုပ်ဆောင်ပုံ။"],
      ["/our-work", "ဖောက်သည်တစ်ဦးချင်း ရွေးချယ်ခဲ့သည့်အရာနှင့် ရရှိလာသော အကျိုးကျေးဇူး။"],
    ] as const;

    for (const [path, heading] of cases) {
      window.history.pushState({}, "", path);
      const { unmount } = render(<App />);
      await userEvent.click(screen.getByRole("button", { name: /switch to Myanmar language/i }));
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
      unmount();
    }
  });

  it("connects all seven journal links to complete articles", () => {
    window.history.pushState({}, "", "/journal");
    const { unmount } = render(<App />);
    expect(screen.getAllByRole("link", { name: /read article/i })).toHaveLength(7);
    unmount();

    window.history.pushState({}, "", "/journal/why-online-presence-matters");
    render(<App />);
    expect(screen.getByRole("heading", { name: /why online presence matters for local businesses/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /the decision begins before the visit/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /your practical checklist/i })).toBeInTheDocument();
  });
});
