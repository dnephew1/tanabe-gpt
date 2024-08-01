const SUMMARY_TIMES = [9, 12, 15, 18, 21];

// Get current time in Brasilia
const brasiliaTime = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Sao_Paulo"}));
brasiliaTime.setSeconds(0, 0);
const currentHour = brasiliaTime.getHours();
console.log('current hour in Brasilia is ' + currentHour);

// Find next run time in Brasilia time
let nextRunTime = new Date(brasiliaTime);
const nextHour = SUMMARY_TIMES.find(hour => hour > currentHour) || SUMMARY_TIMES[0];
nextRunTime.setHours(nextHour, 0, 0, 0);

if (nextHour <= currentHour) {
    nextRunTime.setDate(nextRunTime.getDate() + 1);
}

// Calculate delay in milliseconds
const now = new Date();
const delay = nextRunTime.getTime() - brasiliaTime.getTime();
console.log(nextRunTime.getHours());
console.log(brasiliaTime.getHours());
console.log(delay);

setTimeout(() => {
    console.log('next run'+ nextRunTime);
}, delay);

console.log('next run'+ nextRunTime);
