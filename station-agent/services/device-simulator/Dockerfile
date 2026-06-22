FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /repo

# Copy Directory props
COPY Directory.Build.props ./
COPY Directory.Packages.props ./

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
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

USER root
RUN mkdir -p /data /app/logs && \
    chown -R app:app /data /app

COPY --chown=app:app --from=build /app .

USER app
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
ENTRYPOINT ["dotnet", "ND.DeviceSimulator.Api.dll"]
