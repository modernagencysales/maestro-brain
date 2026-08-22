import * as React from "react";

import { Box, Text } from "@chakra-ui/react";
import { format } from "date-fns";

export interface MetricData {
  timestamp: number;
  value: number;
}

export const RevenueChart = ({ data = [] }: { data: MetricData[] }) => {
  const parsedData = React.useMemo(
    () =>
      data?.map(({ timestamp, value }) => {
        return {
          date: format(timestamp, "d/L"),
          Revenue: value,
        };
      }),
    [data],
  );

  const maximum = Math.max(1, ...parsedData.map((point) => point.Revenue));
  const points = parsedData
    .map((point, index) => {
      const x =
        parsedData.length > 1 ? (index / (parsedData.length - 1)) * 100 : 50;
      const y = 100 - (point.Revenue / maximum) * 90;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <Box height="300px" position="relative" aria-label="Revenue chart">
      {parsedData.length ? (
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          width="100%"
          height="100%"
        >
          <polyline
            points={points}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : (
        <Text color="fg.muted">No revenue data yet.</Text>
      )}
    </Box>
  );
};
