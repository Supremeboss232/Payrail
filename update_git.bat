@echo off
cd /d "D:\Finance\payment rail"
echo ========================================================
echo [Payrail v3.0] Staging all files...
echo ========================================================
git add -A

echo.
echo ========================================================
echo [Payrail v3.0] Committing Payrail v3.0 Architecture...
echo ========================================================
git commit -m "feat(v3.0): complete UI redesign across 3 distinct architectural worlds (Showcase, Clearinghouse Deck, Executive Treasury Workstation) & ISO 20022 RTGS/DNS engine"

echo.
echo ========================================================
echo [Payrail v3.0] Pushing to remote repository...
echo ========================================================
git push origin main

echo.
echo ========================================================
echo [Payrail v3.0] Git update complete!
echo ========================================================
pause
