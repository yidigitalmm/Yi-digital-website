import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
vi.mock("./ContactVerification", () => ({ ContactVerification: ({ onToken, resetKey }: { onToken: (token: string) => void; resetKey: number }) => {
  useEffect(() => { onToken("test-token"); }, [onToken, resetKey]); return null;
} }));
const trackLead = vi.fn();
beforeEach(() => {
  trackLead.mockClear();
  vi.stubGlobal("gtag", trackLead);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function fillForm() {
  window.history.pushState({}, "", "/contact");
  render(<App />);
  await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Test Customer");
  await userEvent.type(screen.getByRole("textbox", { name: "Email" }), "customer@example.com");
  await userEvent.type(screen.getByRole("textbox", { name: "Phone number" }), "+959123456789");
  await userEvent.type(screen.getByRole("textbox", { name: "Short message" }), "Please help with my website.");
}
describe("contact submission UI", () => {
  it("blocks submission when the required phone number is empty", async () => {
    const mock = vi.fn(); vi.stubGlobal("fetch", mock);
    await fillForm();
    const phone = screen.getByRole("textbox", { name: "Phone number" });
    await userEvent.clear(phone);
    expect(phone).toBeRequired();
    await userEvent.click(screen.getByRole("button", { name: "Request a consultation" }));
    expect(phone).toBeInvalid();
    expect(mock).not.toHaveBeenCalled();
    expect(trackLead).not.toHaveBeenCalled();
  });
  it("stays on the page and confirms only a successful API response", async () => {
    const mock = vi.fn().mockResolvedValue(Response.json({ success: true }));vi.stubGlobal("fetch", mock);
    await fillForm();
    await userEvent.click(screen.getByRole("button", { name: "Request a consultation" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Your enquiry has been submitted");
    const popup = screen.getByRole("dialog");
    await userEvent.click(screen.getByText(/Your enquiry has been submitted/));
    expect(popup).toHaveAttribute("open");
    fireEvent.click(popup, { clientX: -10, clientY: -10 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/contact");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("");
    expect(mock.mock.calls[0][0]).toBe("/api/contact");
    expect(JSON.parse(mock.mock.calls[0][1].body)).toMatchObject({ email: "customer@example.com", token: "test-token" });
    expect(trackLead).toHaveBeenCalledExactlyOnceWith("event", "generate_lead", { form_name: "contact_enquiry" });
  });
  it("preserves the enquiry and offers email fallback after a service failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Unavailable" }, { status: 503 })));
    await fillForm();
    await userEvent.click(screen.getByRole("button", { name: "Request a consultation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("yidigitalmm@gmail.com");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Short message" })).toHaveValue("Please help with my website.");
    expect(screen.getByRole("button", { name: "Request a consultation" })).toBeEnabled();
    expect(trackLead).not.toHaveBeenCalled();
  });
  it.each([undefined, () => { throw new Error("Analytics unavailable"); }])("confirms the enquiry even when analytics is unavailable (%s)", async (gtag) => {
    vi.stubGlobal("gtag", gtag);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: true })));
    await fillForm();
    await userEvent.click(screen.getByRole("button", { name: "Request a consultation" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Your enquiry has been submitted");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("does not count an unconfirmed response as a lead", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: false })));
    await fillForm();
    await userEvent.click(screen.getByRole("button", { name: "Request a consultation" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(trackLead).not.toHaveBeenCalled();
  });
});
