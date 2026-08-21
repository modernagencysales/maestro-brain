import type { ReactNode } from "react";

export const DateTime = ({
  children,
  date,
  style,
}: {
  children?: ReactNode;
  date?: Date;
  style?: "short" | "long" | "narrow";
}) =>
  children ??
  (date
    ? date.toLocaleDateString(undefined, {
        dateStyle: style === "narrow" ? "short" : style,
      })
    : null);
export const RelativeTime = DateTime;
export const DateTimeSince = DateTime;
export const useIntl = () => ({
  formatDate: (date: Date) => date.toLocaleDateString(),
  formatTime: (date: Date) => date.toLocaleTimeString(),
});
export const FormattedDate = ({ value }: { value: Date | string | number }) =>
  new Date(value).toLocaleDateString();
export const FormattedNumber = ({
  value,
  ...options
}: {
  value: number;
  currency?: string;
  style?: Intl.NumberFormatOptions["style"];
}) => value.toLocaleString(undefined, options);
