FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_GCConserveMemory=9
COPY Directory.Build.props ./
COPY Directory.Packages.props ./
COPY station-agent.sln ./
COPY shared/ shared/
COPY services/mqtt-adapter/ services/mqtt-adapter/
RUN dotnet restore services/mqtt-adapter/src/ND.MqttAdapter.Worker/ND.MqttAdapter.Worker.csproj
RUN dotnet publish services/mqtt-adapter/src/ND.MqttAdapter.Worker/ND.MqttAdapter.Worker.csproj -c Release -o /app/publish --no-restore /p:UseSharedCompilation=false /p:ConcurrentBuild=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
USER app
COPY --chown=app:app --from=build /app/publish .
VOLUME ["/data", "/logs"]
ENV DOTNET_ENVIRONMENT=Production
ENTRYPOINT ["dotnet", "ND.MqttAdapter.Worker.dll"]
