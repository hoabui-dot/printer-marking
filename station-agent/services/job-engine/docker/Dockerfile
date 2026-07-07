FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_GCConserveMemory=9
COPY Directory.Build.props ./
COPY Directory.Packages.props ./
COPY station-agent.sln ./
COPY shared/ shared/
COPY services/job-engine/ services/job-engine/
RUN dotnet restore services/job-engine/src/ND.JobEngine.Api/ND.JobEngine.Api.csproj
RUN dotnet publish services/job-engine/src/ND.JobEngine.Api/ND.JobEngine.Api.csproj -c Release -o /app/publish --no-restore /p:UseSharedCompilation=false /p:ConcurrentBuild=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
USER app
COPY --chown=app:app --from=build /app/publish .
VOLUME ["/data", "/logs"]
EXPOSE 5002
ENV DOTNET_ENVIRONMENT=Production
ENV ASPNETCORE_URLS=http://+:5002
ENTRYPOINT ["dotnet", "ND.JobEngine.Api.dll"]
