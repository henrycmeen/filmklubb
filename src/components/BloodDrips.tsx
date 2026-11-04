import { useId, type CSSProperties } from "react";
import styles from "@/styles/nextScreeningPreview.module.css";

const streams = [
  { x: 64, length: 14, radius: 3.6, seconds: 9.5, delay: -1.2 },
  { x: 151, length: 22, radius: 4.4, seconds: 7.2, delay: -4.6 },
  { x: 283, length: 10, radius: 3.2, seconds: 11, delay: -7.9, minor: true },
  { x: 402, length: 26, radius: 4.8, seconds: 8.1, delay: -2.8 },
  { x: 497, length: 16, radius: 3.8, seconds: 10.4, delay: -6.1, minor: true },
];

/** Decorative local-preview liquid: grow, pinch off, fall, then refill. */
export function BloodDrips() {
  const filterId = `blood-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      className={styles.blood}
      viewBox="0 0 560 130"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <filter
          id={filterId}
          x="-5%"
          y="-15%"
          width="110%"
          height="140%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.4" result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8"
            result="liquid"
          />
          <feGaussianBlur in="liquid" stdDeviation="1.2" result="height" />
          <feSpecularLighting
            in="height"
            surfaceScale="2.5"
            specularConstant="0.65"
            specularExponent="22"
            lightingColor="#ff9b86"
            result="shine"
          >
            <feDistantLight azimuth="235" elevation="50" />
          </feSpecularLighting>
          <feComposite in="shine" in2="liquid" operator="in" result="gloss" />
          <feComposite
            in="liquid"
            in2="gloss"
            operator="arithmetic"
            k2="1"
            k3="0.45"
          />
        </filter>
      </defs>
      <g filter={`url(#${filterId})`} fill="#951416">
        <path d="M14 0H546V5C522 7 506 4 497 9C486 5 430 7 402 11C380 6 302 7 283 8C262 5 172 8 151 11C130 6 82 8 64 9C42 5 26 6 14 4Z" />
        {streams.map((stream) => (
          <g
            key={stream.x}
            className={stream.minor ? styles.minorStream : undefined}
            style={
              {
                "--blood-length": `${stream.length}px`,
                "--blood-seconds": `${stream.seconds}s`,
                "--blood-delay": `${stream.delay}s`,
              } as CSSProperties
            }
          >
            <rect
              className={styles.bloodStem}
              x={stream.x - stream.radius * 0.45}
              y="4"
              width={stream.radius * 0.9}
              height={stream.length}
              rx={stream.radius * 0.45}
            />
            <circle
              className={styles.bloodBead}
              cx={stream.x}
              cy={4 + stream.length}
              r={stream.radius}
            />
          </g>
        ))}
      </g>
    </svg>
  );
}
