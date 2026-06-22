FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY Directory.Build.props ./
COPY Directory.Packages.props ./
COPY station-agent.sln ./
COPY shared/ shared/
COPY services/laser-adapter/ services/laser-adapter/
RUN dotnet restore services/laser-adapter/src/ND.LaserAdapter.Api/ND.LaserAdapter.Api.csproj
RUN dotnet publish services/laser-adapter/src/ND.LaserAdapter.Api/ND.LaserAdapter.Api.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
USER app
COPY --chown=app:app --from=build /app/publish .
VOLUME ["/data", "/logs"]
EXPOSE 5004
ENV ASPNETCORE_URLS=http://+:5004
ENTRYPOINT ["dotnet", "ND.LaserAdapter.Api.dll"]
