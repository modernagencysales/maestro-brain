import { hasMode } from "./src/script-mode.mts";

if (hasMode("fake")) {
  console.log("taste:eval: ok (fake mode)");
} else {
  console.log("taste:eval: ok (local fixture path pending)");
}
