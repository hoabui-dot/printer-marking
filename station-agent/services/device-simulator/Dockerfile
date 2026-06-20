FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /repo

# Copy shared projects
COPY shared/ shared/

# Copy service source
COPY services/device-simulator/ services/device-simulator/

# Build React frontend
WORKDIR /repo/services/device-simulator/frontend
RUN apt-get update && apt-get install -y nodejs npm && npm ci && npm run build

# Build .NET backend
WORKDIR /repo/services/device-simulator
RUN dotnet publish src/ND.DeviceSimulator.Api/ND.DeviceSimulator.Api.csproj \
    -c Release -o /app --no-restore || dotnet publish src/ND.DeviceSimulator.Api/ND.DeviceSimulator.Api.csproj -c Release -o /app

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app

RUN adduser --disabled-password --gecos "" appuser && \
    mkdir -p /data /app/logs && \
    chown -R appuser:appuser /data /app

COPY --from=build /app .

USER appuser
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
ENTRYPOINT ["dotnet", "ND.DeviceSimulator.Api.dll"]
