/**
 * A dashboard count as a share of all users: "12.3% of users", one decimal.
 * Nothing when the count is unknown (`null`: the database's stats function
 * predates it) or there are no users to divide by.
 */
export function shareOfUsers(count: number | null, totalUsers: number): string | null {
  if (count === null || totalUsers <= 0) return null
  const percent = Math.round((count / totalUsers) * 1000) / 10
  return `${percent.toLocaleString("en-US")}% of users`
}
