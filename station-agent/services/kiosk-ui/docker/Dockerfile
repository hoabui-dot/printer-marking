# Stage 1: Build React frontend
FROM node:20-alpine AS frontend-build
WORKDIR /frontend
COPY services/kiosk-ui/frontend/package.json ./
RUN npm install
COPY services/kiosk-ui/frontend/ ./
RUN npm run build

# Stage 2: Build .NET API
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api-build
WORKDIR /src
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_GCConserveMemory=9
COPY Directory.Build.props ./
COPY Directory.Packages.props ./
COPY station-agent.sln ./
COPY shared/ shared/
COPY services/kiosk-ui/ services/kiosk-ui/

# Copy built frontend into wwwroot
COPY --from=frontend-build /src/ND.KioskUi.Api/wwwroot/ services/kiosk-ui/src/ND.KioskUi.Api/wwwroot/

RUN dotnet restore services/kiosk-ui/src/ND.KioskUi.Api/ND.KioskUi.Api.csproj
RUN dotnet publish services/kiosk-ui/src/ND.KioskUi.Api/ND.KioskUi.Api.csproj -c Release -o /app/publish --no-restore /p:UseSharedCompilation=false /p:ConcurrentBuild=false
# Stage 3: Runtime
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
USER app
COPY --chown=app:app --from=api-build /app/publish .
VOLUME ["/data", "/logs"]
EXPOSE 5007
ENV ASPNETCORE_URLS=http://+:5007
ENTRYPOINT ["dotnet", "ND.KioskUi.Api.dll"]
